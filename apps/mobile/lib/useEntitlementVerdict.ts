/**
 * One account-bound server verdict gates the app; RevenueCat on the phone
 * triggers sync and only a confirmed store purchase/restore grants brief grace.
 * A null entitlement holds gates while the server settles, with a fresh cache
 * used only as a bounded offline fallback. PurchasesProvider supplies the
 * device CustomerInfo hint.
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { EntitlementVerdict } from './entitlementVerdictTypes';
import type { CustomerInfo } from 'react-native-purchases';
import type { SubscriptionStatusResult, SubscriptionVerdict } from './apiClient';
import { supabase } from './supabase';
import { withinMs } from './async';
import {
  CACHE_MAX_AGE_MS,
  clearCachedEntitlement,
  fetchServerEntitlement,
  readCachedEntitlement,
  writeCachedEntitlement,
  type EntitlementCheckError,
  type EntitlementSyncReason,
} from './entitlement';
import { isProActive } from './purchases';
import { BOOT_VERDICT_CAP_MS, useBootEntitlement } from './useBootEntitlement';
export { BOOT_VERDICT_CAP_MS } from './useBootEntitlement';
import { trackEntitlementMismatch, trackEntitlementSyncFailed } from './analytics';

// After the store confirms a purchase/restore, the server is not allowed to
// downgrade the verdict for this long, whatever the sync reason. RevenueCat's
// REST read can lag StoreKit by seconds, and the search screen's mismatch
// handler fires the instant `entitled` flips true under a locked page, so
// without the window that very sync would apply "false" and bounce the user
// who just paid. The API's data gate still protects paid rows meanwhile, and
// the webhook corrects the server row well inside the window.
export const STORE_GRACE_MS = 60_000;

export type { EntitlementVerdict } from './entitlementVerdictTypes';

export function useEntitlementVerdict({
  customerInfoRef,
}: {
  customerInfoRef: MutableRefObject<CustomerInfo | null>;
}): EntitlementVerdict {
  const [entitled, setEntitledState] = useState<boolean | null>(null);
  const [classification, setClassificationState] = useState<SubscriptionVerdict | 'loading'>('loading');
  const [entitlementError, setEntitlementError] = useState<EntitlementCheckError | null>(null);
  const entitlementRequestRef = useRef(0);
  const classificationRef = useRef<SubscriptionVerdict | 'loading'>('loading');
  const setClassification = useCallback((next: SubscriptionVerdict | 'loading') => {
    if (next !== 'unknown') setEntitlementError(null);
    classificationRef.current = next;
    setClassificationState(next);
  }, []);
  const entitledRef = useRef<boolean | null>(null);
  const setEntitled = useCallback((next: boolean | null | ((current: boolean | null) => boolean | null)) => {
    setEntitledState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      entitledRef.current = value;
      return value;
    });
  }, []);
  const storeConfirmedAtRef = useRef(0);
  const activePeriodRef = useRef<{ userId: string; expiresAt: number } | null>(null);
  const proofRef = useRef<{ userId: string; verifiedAt: number } | null>(null);
  const rememberActivePeriod = useCallback((userId: string, expiresAt: string | null) => {
    const parsed = expiresAt ? Date.parse(expiresAt) : NaN;
    activePeriodRef.current = Number.isFinite(parsed) ? { userId, expiresAt: parsed } : null;
  }, []);
  // A native update or purchase may settle while boot is still reading the
  // older account verdict. Boot must not replace that newer result.
  const verdictGenerationRef = useRef(0);
  // Sign-out must not overtake a newer sign-in or call auth-js reentrantly.
  const signInEpochRef = useRef(0);
  const signOutEpochRef = useRef(0);
  const inStoreGrace = useCallback(() => Date.now() - storeConfirmedAtRef.current < STORE_GRACE_MS, []);

  /** Preserve the latest failure for recovery. Null = couldn't ask, or the session moved on. */
  const fetchVerdict = useCallback(async (reason: EntitlementSyncReason, userId: string) => {
    const request = ++entitlementRequestRef.current;
    const epoch = signInEpochRef.current;
    // During store grace, use the server's never-downgrade path so a lagging
    // read cannot persist expired and supersede the real purchase webhook.
    const wireReason = reason !== 'boot' && inStoreGrace() ? 'purchase' : reason;
    const { data: result, error } = await fetchServerEntitlement(wireReason);
    if (result === null) {
      trackEntitlementSyncFailed({ reason });
    }
    try {
      // The answer is about the user who was signed in when we asked. If the
      // session changed or ended mid-flight (sign-out, fast re-sign-in as
      // someone else) it must not become the new user's verdict.
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== userId || signInEpochRef.current !== epoch) return null;
    } catch {
      return null;
    }
    // An older request must not replace the retry's explanation.
    if (request === entitlementRequestRef.current) setEntitlementError(error);
    return result;
  }, [inStoreGrace]);

  /** Store a server answer; resolves to the verdict now in effect. */
  const applyVerdict = useCallback(
    (reason: EntitlementSyncReason, result: SubscriptionStatusResult, userId: string): boolean | null => {
      if (result.verdict === 'unknown') {
        verdictGenerationRef.current += 1;
        // StoreKit has already confirmed this purchase or restore. Keep its
        // bounded grace verdict while the API has no usable RevenueCat proof.
        if (inStoreGrace()) return true;
        activePeriodRef.current = null;
        proofRef.current = null;
        setClassification('unknown');
        setEntitled(null);
        return null;
      }
      const active = result.verdict === 'active';
      const devicePro = isProActive(customerInfoRef.current);
      if (devicePro !== active) {
        trackEntitlementMismatch({ reason, device_pro: devicePro, server_active: active });
      }
      verdictGenerationRef.current += 1;
      if (!active && devicePro && inStoreGrace()) {
        // Inside the post-store grace window (see STORE_GRACE_MS) a server
        // "false" never downgrades: the verdict set in markStoreConfirmed
        // stands and the cache is left alone. Bouncing a user who just paid
        // to the paywall is the worse failure.
        return true;
      }
      setClassification(result.verdict);
      setEntitled(active);
      const verifiedAt = result.lastRcVerifiedAt ? Date.parse(result.lastRcVerifiedAt) : NaN;
      proofRef.current = Number.isFinite(verifiedAt) ? { userId, verifiedAt } : null;
      rememberActivePeriod(userId, active ? result.expiresAt : null);
      void writeCachedEntitlement(userId, result);
      return active;
    },
    [customerInfoRef, inStoreGrace, rememberActivePeriod, setEntitled, setClassification],
  );

  const runSync = useCallback(
    async (reason: EntitlementSyncReason, userId: string): Promise<boolean | null> => {
      const result = await fetchVerdict(reason, userId);
      if (result === null) {
        const period = activePeriodRef.current;
        const proof = proofRef.current;
        const cached = proof?.userId === userId ? null : await readCachedEntitlement(userId);
        const verifiedAt = proof?.userId === userId ? proof.verifiedAt :
          (cached?.lastRcVerifiedAt ? Date.parse(cached.lastRcVerifiedAt) : null);
        const expiredPeriod = period?.userId === userId && period.expiresAt <= Date.now();
        const staleProof = verifiedAt === null || Date.now() - verifiedAt > CACHE_MAX_AGE_MS;
        if ((expiredPeriod || staleProof) && !inStoreGrace()) {
          const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          if (data.session?.user.id !== userId) return null;
          verdictGenerationRef.current += 1;
          activePeriodRef.current = null;
          proofRef.current = null;
          setClassification('unknown');
          setEntitled(null);
        }
        return null;
      }
      return applyVerdict(reason, result, userId);
    },
    [fetchVerdict, applyVerdict, inStoreGrace, setClassification, setEntitled],
  );

  const syncEntitlement = useCallback(
    async (reason: EntitlementSyncReason): Promise<boolean | null> => {
      try {
        // No session: nothing to be entitled as. Also keeps the anonymous
        // teaser from firing an authenticated request that a 401 would turn
        // into a "session expired" bounce.
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          // Inside the grace window the store just confirmed Pro; a session
          // auth-js dropped meanwhile must not bounce the charged user (the
          // paywall refuses to start a purchase without one, so this is the
          // rare drop-during-StoreKit case). Mirrors applyVerdict.
          if (inStoreGrace()) return entitledRef.current;
          setEntitled(false);
          setClassification('never_subscribed');
          return false;
        }
        return await runSync(reason, data.session.user.id);
      } catch {
        return null;
      }
    },
    [runSync, inStoreGrace, setEntitled, setClassification],
  );

  const syncForPaywall = useCallback(async (): Promise<SubscriptionVerdict> => {
    const settled = await syncEntitlement('mismatch');
    return settled === null || classificationRef.current === 'loading' ? 'unknown' : classificationRef.current;
  }, [syncEntitlement]);

  const syncRestoredHistory = useCallback(async (userId: string): Promise<SubscriptionVerdict | null> => {
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (data.session?.user.id !== userId) return null;
    const generation = verdictGenerationRef.current;
    const result = await fetchVerdict('restore_history', userId);
    const current = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (current.data.session?.user.id !== userId) return null;
    if (verdictGenerationRef.current !== generation) {
      const latest = classificationRef.current;
      return latest === 'active' || latest === 'expired' ? latest : null;
    }
    const verifiedAt = result?.lastRcVerifiedAt ? Date.parse(result.lastRcVerifiedAt) : NaN;
    if (!result?.synced || result.stale || !Number.isFinite(verifiedAt) ||
        Date.now() - verifiedAt > CACHE_MAX_AGE_MS || verifiedAt > Date.now() + 60_000 ||
        (result.verdict !== 'active' && result.verdict !== 'expired')) {
      // A prior DB proof cannot confirm this receipt transfer. Hold/retry
      // without erasing known history or overriding a newer store purchase.
      if (!inStoreGrace()) {
        verdictGenerationRef.current += 1;
        if (classificationRef.current === 'never_subscribed') void clearCachedEntitlement();
        setClassification('unknown');
        setEntitled(null);
      }
      return null;
    }
    applyVerdict('restore_history', result, userId);
    return result.verdict;
  }, [fetchVerdict, applyVerdict, inStoreGrace, setClassification, setEntitled]);

  const { resolveAtBoot, settleAfterBootFailure } = useBootEntitlement({
    verdictGenerationRef, customerInfoRef, fetchVerdict, applyVerdict, setEntitled, setClassification, rememberActivePeriod,
  });

  const resolveAfterSignIn = useCallback(
    async (userId: string, identify: () => Promise<CustomerInfo | null>) => {
      // Hold the gates: the sign-in screen replaces to the tabs before the
      // server has answered, and a stale "false" would bounce a returning
      // subscriber to the paywall for the length of a round trip.
      const epoch = ++signInEpochRef.current;
      setEntitled(null);
      setClassification('loading');
      const identity = identify().catch(() => null);
      const info = await withinMs(identity, BOOT_VERDICT_CAP_MS);
      if (epoch !== signInEpochRef.current) return;
      const server = await withinMs(syncEntitlement('sign_in'), BOOT_VERDICT_CAP_MS);
      if (epoch !== signInEpochRef.current) return;
      // The still-running sync applies its late answer, as at boot.
      if (server === null && classificationRef.current === 'loading') {
        setClassification('unknown');
        setEntitled(null);
      }
      if (info === null) {
        // A slow identity can reveal Pro only after the first server sync has
        // settled false. Re-read the authoritative server for that same user,
        // as boot does; CustomerInfo alone never opens the gate.
        void identity.then(async late => {
          if (!isProActive(late) || epoch !== signInEpochRef.current || entitledRef.current !== false) return;
          const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          if (epoch === signInEpochRef.current && data.session?.user.id === userId && entitledRef.current === false) {
            void syncEntitlement('mismatch');
          }
        });
      }
    },
    [syncEntitlement, setEntitled, setClassification],
  );

  const markStoreConfirmed = useCallback(() => {
    storeConfirmedAtRef.current = Date.now();
    verdictGenerationRef.current += 1;
    setEntitled(true);
    setClassification('active');
    // The old confirmed "never subscribed" cache predates this StoreKit
    // result. Drop it now; the next successful RC sync writes a new proof.
    return clearCachedEntitlement();
  }, [setEntitled, setClassification]);

  const beginSignOut = useCallback(() => {
    // Null, not false: a false here would have the still-mounted tabs layout
    // redirect to the paywall before the caller's own navigation lands. The
    // cache and grace window belong to the user who just left.
    // Invalidate a pending sign-in fallback before it can reopen the gates.
    signOutEpochRef.current = ++signInEpochRef.current;
    setEntitled(null);
    setClassification('loading');
    void clearCachedEntitlement();
    storeConfirmedAtRef.current = 0;
    activePeriodRef.current = null;
    proofRef.current = null;
  }, [setEntitled, setClassification]);

  const settleAfterSignOut = useCallback(() => {
    // Decided from the auth events alone, never from getSession: auth-js
    // runs SIGNED_OUT subscribers inside signOut's lock, and a getSession
    // queued behind that lock deadlocked every later session read. A
    // sign-in that arrived since owns the verdict; otherwise anonymous, and
    // null must never be left behind.
    if (signInEpochRef.current !== signOutEpochRef.current) return;
    setEntitled((current) => current ?? false);
    setClassification('never_subscribed');
  }, [setEntitled, setClassification]);

  return {
    entitled,
    classification,
    entitlementError,
    entitledRef,
    inStoreGrace,
    syncEntitlement,
    syncRestoredHistory,
    syncForPaywall,
    resolveAtBoot,
    settleAfterBootFailure,
    resolveAfterSignIn,
    markStoreConfirmed,
    beginSignOut,
    settleAfterSignOut,
  };
}
