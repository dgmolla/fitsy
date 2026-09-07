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
import type { CustomerInfo } from 'react-native-purchases';
import { supabase } from './supabase';
import { withinMs } from './async';
import {
  clearCachedEntitlement,
  fetchServerEntitlement,
  readCachedEntitlement,
  writeCachedEntitlement,
  type EntitlementSyncReason,
} from './entitlement';
import { isProActive } from './purchases';
import { trackEntitlementMismatch, trackEntitlementSyncFailed } from './analytics';

// After the store confirms a purchase/restore, the server is not allowed to
// downgrade the verdict for this long, whatever the sync reason. RevenueCat's
// REST read can lag StoreKit by seconds, and the search screen's mismatch
// handler fires the instant `entitled` flips true under a locked page, so
// without the window that very sync would apply "false" and bounce the user
// who just paid. The API's data gate still protects paid rows meanwhile, and
// the webhook corrects the server row well inside the window.
export const STORE_GRACE_MS = 60_000;

// Boot and sign-in hold every gate (`entitled === null`) for up to this long
// so the server can answer BEFORE anything gates. Past the cap the cache (at
// boot) or the device's RevenueCat state stands in, and the still-running
// sync applies the late answer when it arrives.
export const BOOT_VERDICT_CAP_MS = 1500;

export interface EntitlementVerdict {
  /** The server's verdict; null until settled on this launch. Gates screens. */
  entitled: boolean | null;
  /** Same value, readable from async callbacks. */
  entitledRef: MutableRefObject<boolean | null>;
  /**
   * Ask the server and store the answer. Resolves to the verdict NOW IN
   * EFFECT: the stored answer, or `true` when a server "false" was refused
   * inside the store grace window. Null when the server couldn't be asked
   * (`entitled` unchanged); `false` without a session, with no request made.
   */
  syncEntitlement: (reason: EntitlementSyncReason) => Promise<boolean | null>;
  /**
   * Boot: cache read + capped server fetch run in parallel with the caller's
   * RevenueCat work (`rcReady`), then one fold: server, else cache, else the
   * device. Rejects if `rcReady` rejects (see settleAfterBootFailure).
   */
  resolveAtBoot: (
    userId: string | undefined,
    rcReady: Promise<CustomerInfo | null>,
    isCancelled: () => boolean,
  ) => Promise<void>;
  /** Boot threw: still settle (cache, else device, else false) so no gate holds forever. */
  settleAfterBootFailure: (userId: string | undefined, isCancelled: () => boolean) => Promise<void>;
  /**
   * Sign-in: hold the gates (null), identify, give the server the cap, else
   * fall back to the device; the late answer still applies.
   */
  resolveAfterSignIn: (identify: () => Promise<CustomerInfo | null>) => Promise<void>;
  /** The store just confirmed Pro: entitled now, cached, grace window open. */
  markStoreConfirmed: () => void;
  /** Sign-out, synchronous half: hold the gates (null), drop cache and grace window. */
  beginSignOut: () => void;
  /** Sign-out, after the RevenueCat logout: not entitled if there is still no session. */
  settleAfterSignOut: () => Promise<void>;
}

export function useEntitlementVerdict({
  customerInfoRef,
}: {
  customerInfoRef: MutableRefObject<CustomerInfo | null>;
}): EntitlementVerdict {
  const [entitled, setEntitledState] = useState<boolean | null>(null);
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

  /** Server round trip only: no state. Null = couldn't ask, or the session moved on. */
  const fetchVerdict = useCallback(async (reason: EntitlementSyncReason, userId: string) => {
    const active = await fetchServerEntitlement(reason);
    if (active === null) {
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
    return active;
  }, []);

  /** Store a server answer; resolves to the verdict now in effect. */
  const applyVerdict = useCallback(
    (reason: EntitlementSyncReason, active: boolean): boolean => {
      const devicePro = isProActive(customerInfoRef.current);
      if (devicePro !== active) {
        trackEntitlementMismatch({ reason, device_pro: devicePro, server_active: active });
      }
      if (!active && devicePro && Date.now() - storeConfirmedAtRef.current < STORE_GRACE_MS) {
        // Inside the post-store grace window (see STORE_GRACE_MS) a server
        // "false" never downgrades: the verdict set in markStoreConfirmed
        // stands and the cache is left alone. Bouncing a user who just paid
        // to the paywall is the worse failure.
        return true;
      }
      setEntitled(active);
      void writeCachedEntitlement(active);
      return active;
    },
    [customerInfoRef, setEntitled],
  );

  const runSync = useCallback(
    async (reason: EntitlementSyncReason, userId: string): Promise<boolean | null> => {
      const active = await fetchVerdict(reason, userId);
      return active === null ? null : applyVerdict(reason, active);
    },
    [fetchVerdict, applyVerdict],
  );

  const syncEntitlement = useCallback(
    async (reason: EntitlementSyncReason): Promise<boolean | null> => {
      try {
        // No session: nothing to be entitled as. Also keeps the anonymous
        // teaser from firing an authenticated request that a 401 would turn
        // into a "session expired" bounce.
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setEntitled(false);
          return false;
        }
        return await runSync(reason, data.session.user.id);
      } catch {
        return null;
      }
    },
    [runSync, setEntitled],
  );

  const resolveAtBoot = useCallback(
    async (userId: string | undefined, rcReady: Promise<CustomerInfo | null>, isCancelled: () => boolean) => {
      const cachedP = readCachedEntitlement();
      const answer = userId ? fetchVerdict('boot', userId) : Promise.resolve(false);
      const info = await rcReady;
      const [cached, server] = await Promise.all([cachedP, withinMs(answer, BOOT_VERDICT_CAP_MS)]);
      if (isCancelled()) return;
      if (!userId) {
        // Anonymous: never left on null, and a stale cache must not count.
        setEntitled(false);
        return;
      }
      // Applied only now, after the RevenueCat read, so the mismatch event
      // compares against the real device state.
      const effective = server === null ? null : applyVerdict('boot', server);
      // The single settled signal: server, else cache, else the device (so an
      // offline subscriber isn't bounced). `current` covers an answer that
      // landed via another path meanwhile.
      setEntitled((current) => current ?? effective ?? cached ?? isProActive(info));
      if (server === null) {
        // Slow server: apply its answer when it finally lands.
        void answer.then((late) => {
          if (late !== null && !isCancelled()) applyVerdict('boot', late);
        });
      }
    },
    [fetchVerdict, applyVerdict, setEntitled],
  );

  const settleAfterBootFailure = useCallback(
    async (userId: string | undefined, isCancelled: () => boolean) => {
      const cached = userId ? await readCachedEntitlement() : null;
      if (isCancelled()) return;
      setEntitled((current) => current ?? cached ?? (userId ? isProActive(customerInfoRef.current) : false));
    },
    [customerInfoRef, setEntitled],
  );

  const resolveAfterSignIn = useCallback(
    async (identify: () => Promise<CustomerInfo | null>) => {
      // Hold the gates: the sign-in screen replaces to the tabs before the
      // server has answered, and a stale "false" would bounce a returning
      // subscriber to the paywall for the length of a round trip.
      setEntitled(null);
      const info = await identify();
      const server = await withinMs(syncEntitlement('sign_in'), BOOT_VERDICT_CAP_MS);
      // Same fallback rule as boot; the still-running sync applies the late answer.
      if (server === null) setEntitled((current) => current ?? isProActive(info));
    },
    [syncEntitlement, setEntitled],
  );

  const markStoreConfirmed = useCallback(() => {
    storeConfirmedAtRef.current = Date.now();
    setEntitled(true);
    void writeCachedEntitlement(true);
  }, [setEntitled]);

  const beginSignOut = useCallback(() => {
    // Null, not false: a false here would have the still-mounted tabs layout
    // redirect to the paywall before the caller's own navigation lands. The
    // cache and grace window belong to the user who just left.
    setEntitled(null);
    void clearCachedEntitlement();
    storeConfirmedAtRef.current = 0;
  }, [setEntitled]);

  const settleAfterSignOut = useCallback(async () => {
    // A fast re-sign-in owns the verdict from here; otherwise anonymous.
    const { data } = await supabase.auth.getSession();
    if (!data.session) setEntitled((current) => current ?? false);
  }, [setEntitled]);

  return {
    entitled,
    entitledRef,
    syncEntitlement,
    resolveAtBoot,
    settleAfterBootFailure,
    resolveAfterSignIn,
    markStoreConfirmed,
    beginSignOut,
    settleAfterSignOut,
  };
}
