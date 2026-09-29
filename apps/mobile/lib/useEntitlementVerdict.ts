/**
 * The app's single entitlement verdict: `entitled` and the one function that
 * asks the server for it, stores it, and caches it.
 *
 * Why the server decides: every subscription incident so far came from two
 * sources of truth disagreeing (the phone's CustomerInfo gated screens while
 * the API gated data from a webhook-fed row). Screens gate on `entitled`;
 * the phone's RevenueCat state only triggers a sync, with exactly two
 * exceptions where it counts as a verdict: the offline fallback at boot /
 * sign-in, and a confirmed store purchase/restore (`markStoreConfirmed`).
 *
 * `entitled === null` means "not settled on this launch" and is the hold
 * signal for every gate. It is set exactly once per resolution (boot, sign-in,
 * sign-out), never hydrated early from the cache: the cache only takes part
 * in the final fold, so a stale cached verdict can never gate a screen before
 * the server has had its chance to overrule it.
 *
 * Composed by PurchasesProvider (usePurchases.tsx), which owns the RevenueCat
 * side and hands this hook the CustomerInfo ref it needs for the device hint.
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { EntitlementVerdict } from './entitlementVerdictTypes';
import type { CustomerInfo } from 'react-native-purchases';
import type { SubscriptionStatusResult, SubscriptionVerdict } from './apiClient';
import { supabase } from './supabase';
import { withinMs } from './async';
import {
  clearCachedEntitlement,
  fetchServerEntitlement,
  writeCachedEntitlement,
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

// Each boot/sign-in prerequisite uses this cap so a stalled read cannot hold
// every gate indefinitely. The cache (at boot) or the device's RevenueCat
// state stands in when the server cannot answer; a late server answer applies.

export type { EntitlementVerdict } from './entitlementVerdictTypes';

export function useEntitlementVerdict({
  customerInfoRef,
}: {
  customerInfoRef: MutableRefObject<CustomerInfo | null>;
}): EntitlementVerdict {
  const [entitled, setEntitledState] = useState<boolean | null>(null);
  const [classification, setClassificationState] = useState<SubscriptionVerdict | 'loading'>('loading');
  const classificationRef = useRef<SubscriptionVerdict | 'loading'>('loading');
  const setClassification = useCallback((next: SubscriptionVerdict | 'loading') => {
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
  // When the store last confirmed Pro (markStoreConfirmed); 0 = never.
  const storeConfirmedAtRef = useRef(0);
  const activePeriodRef = useRef<{ userId: string; expiresAt: number } | null>(null);
  const rememberActivePeriod = useCallback((userId: string, expiresAt: string | null) => {
    const parsed = expiresAt ? Date.parse(expiresAt) : NaN;
    activePeriodRef.current = Number.isFinite(parsed) ? { userId, expiresAt: parsed } : null;
  }, []);
  // A native update or purchase may settle while boot is still reading the
  // older account verdict. Boot must not replace that newer result.
  const verdictGenerationRef = useRef(0);
  // Counts sign-ins, so a sign-out can tell whether one overtook it without
  // asking auth-js (see settleAfterSignOut).
  const signInEpochRef = useRef(0);
  const signOutEpochRef = useRef(0);
  const inStoreGrace = useCallback(() => Date.now() - storeConfirmedAtRef.current < STORE_GRACE_MS, []);

  /** Server round trip only: no state. Null = couldn't ask, or the session moved on. */
  const fetchVerdict = useCallback(async (reason: EntitlementSyncReason, userId: string) => {
    // Inside the grace window every re-read goes over the wire as 'purchase':
    // the server's never-downgrade path. A 'mismatch' sync fires at 0 ms
    // right after a purchase, and with a lagging RevenueCat read the server
    // would otherwise persist "expired" with a fresh lastEventAt onto an
    // existing row and mark the real INITIAL_PURCHASE webhook stale. The
    // caller's reason still tags the client-side analytics below.
    const wireReason = reason !== 'boot' && inStoreGrace() ? 'purchase' : reason;
    const result = await fetchServerEntitlement(wireReason);
    if (result === null) {
      trackEntitlementSyncFailed({ reason });
      return null;
    }
    try {
      // The answer is about the user who was signed in when we asked. If the
      // session changed or ended mid-flight (sign-out, fast re-sign-in as
      // someone else) it must not become the new user's verdict.
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== userId) return null;
    } catch {
      return null;
    }
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
        if (period?.userId === userId && period.expiresAt <= Date.now() && !inStoreGrace()) {
          const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          if (data.session?.user.id !== userId) return null;
          verdictGenerationRef.current += 1;
          activePeriodRef.current = null;
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
      // Same fallback rule as boot; the still-running sync applies the late answer.
      if (server === null && classificationRef.current === 'loading') {
        setClassification(isProActive(info) ? 'active' : 'unknown');
        setEntitled((current) => current ?? (isProActive(info) ? true : null));
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
    entitledRef,
    inStoreGrace,
    syncEntitlement,
    syncForPaywall,
    resolveAtBoot,
    settleAfterBootFailure,
    resolveAfterSignIn,
    markStoreConfirmed,
    beginSignOut,
    settleAfterSignOut,
  };
}
