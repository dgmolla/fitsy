/**
 * RevenueCat React context and the app's single entitlement verdict.
 *
 * Mounts once near the root (see app/_layout.tsx). It:
 *   1. configures the SDK,
 *   2. keeps the RevenueCat app-user-id aligned with the Supabase session,
 *   3. holds the latest CustomerInfo and exposes `isPro` / `isLapsed`
 *      derived from it (hints and copy, never a gate),
 *   4. owns `entitled`, the SERVER's verdict, and `syncEntitlement`, the one
 *      function that asks for it, stores it, and caches it, and
 *   5. exposes paywall / customer-center / restore actions.
 *
 * Why the server decides: every subscription incident so far came from two
 * sources of truth disagreeing (the phone's CustomerInfo gated screens while
 * the API gated data from a webhook-fed row). Now screens gate on `entitled`,
 * the phone's state only triggers a sync, and the two cannot drift apart for
 * longer than one sync round trip.
 *
 * Screens consume `usePurchases()`; they never import `lib/purchases.ts`
 * (the native seam) directly.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import { supabase } from './supabase';
import {
  clearCachedEntitlement,
  fetchServerEntitlement,
  readCachedEntitlement,
  withinMs,
  writeCachedEntitlement,
  type EntitlementSyncReason,
} from './entitlement';
import {
  addCustomerInfoListener,
  configurePurchases,
  fetchCurrentOffering,
  fetchCustomerInfo,
  hasLapsedEntitlement,
  identifyPurchasesUser,
  isProActive,
  logoutPurchasesUser,
  presentCustomerCenter as rcPresentCustomerCenter,
  presentPaywall as rcPresentPaywall,
  purchasePackage as rcPurchasePackage,
  restorePurchases as rcRestore,
} from './purchases';
import {
  trackCustomerCenterOpened,
  trackEntitlementMismatch,
  trackEntitlementSyncFailed,
  trackPaywallResult,
  trackPaywallShown,
  trackPurchasesRestored,
} from './analytics';

// Post-purchase/restore: the user has just paid and is waiting to get in, so
// the server sync is capped - normally sub-second, and the first search then
// lands unlocked; past the cap we navigate on the device's verdict and the
// search screen's mismatch handler finishes the job.
export const POST_PURCHASE_SYNC_CAP_MS = 4000;

// After the store confirms a purchase/restore, the server is not allowed to
// downgrade the verdict for this long, whatever the sync reason. RevenueCat's
// REST read can lag StoreKit by seconds, and the search screen's mismatch
// handler fires the instant `entitled` flips true under a locked page, so
// without the window that very sync would apply "false" and bounce the user
// who just paid. The API's data gate still protects paid rows meanwhile, and
// the webhook corrects the server row well inside the window.
export const STORE_GRACE_MS = 60_000;

// Boot: the cached verdict is hydrated at once, but screens are held (`ready`
// false) for up to this long so the boot sync can overrule a stale cache
// BEFORE anything gates on it. Otherwise a cached "false" sends the tabs
// layout to the paywall a moment before the server says "true" (and nothing
// on the paywall used to react), or a cached "true" flashes the search shell
// before an expired verdict lands. Past the cap the cache (or the offline
// fallback) stands and a late answer is applied when it arrives.
export const BOOT_VERDICT_CAP_MS = 1500;

export interface PurchasesContextValue {
  /**
   * True once configure, the first CustomerInfo read, and `entitled` have
   * settled: the server answered, or BOOT_VERDICT_CAP_MS passed with the
   * cache / offline fallback standing in.
   */
  ready: boolean;
  /**
   * The server's verdict: may this user use the app? `null` until resolved
   * on this launch (cache, boot sync, or offline fallback). This is what
   * gates screens; `isPro` is not.
   */
  entitled: boolean | null;
  /** Device hint: RevenueCat says the `pro` entitlement is active. */
  isPro: boolean;
  /** True when `pro` was active before but has lapsed (cancelled/expired) - see `hasLapsedEntitlement`. */
  isLapsed: boolean;
  customerInfo: CustomerInfo | null;
  /** Current offering - its `.annual`/`.monthly` packages back the in-app paywall. */
  offering: PurchasesOffering | null;
  /**
   * Ask the server for its verdict and store it. Resolves to the verdict, or
   * `null` when the server couldn't be asked (`entitled` is left unchanged).
   * Without a Supabase session it resolves to `false` without a request.
   */
  syncEntitlement: (reason: EntitlementSyncReason) => Promise<boolean | null>;
  /** Re-fetch CustomerInfo from RevenueCat. */
  refresh: () => Promise<void>;
  /**
   * Re-fetch the current offering. The initial fetch happens once at boot; if
   * it failed (offline at launch, StoreKit hiccup) paywalls call this rather
   * than showing "plans are still loading" until the app is relaunched.
   * Resolves to the offering so callers can retry a purchase in one step.
   */
  refreshOffering: () => Promise<PurchasesOffering | null>;
  /**
   * Buy a package from our own paywall UI. `source` tags analytics
   * (e.g. 'onboarding', 'profile'). Resolves to true whenever the store
   * flow confirmed Pro (and sets `entitled` to true), after giving the
   * server a capped chance to hear about it - see settleAfterStore.
   */
  purchase: (pkg: PurchasesPackage, source: string) => Promise<boolean>;
  /**
   * Present the RevenueCat paywall. `source` tags the analytics event
   * (e.g. 'onboarding', 'profile'). Resolves like `purchase`.
   */
  presentPaywall: (source: string) => Promise<boolean>;
  /** Present the Customer Center (manage / cancel / restore / refund). */
  presentCustomerCenter: () => Promise<void>;
  /** Restore prior purchases. Resolves like `purchase`. */
  restore: () => Promise<boolean>;
}

const PurchasesContext = createContext<PurchasesContextValue | undefined>(undefined);

export function PurchasesProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [customerInfo, setCustomerInfoState] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  // Mirror of `customerInfo` readable from async callbacks (the boot sync
  // runs before the first render that would carry it in state).
  const customerInfoRef = useRef<CustomerInfo | null>(null);
  const setCustomerInfo = useCallback((info: CustomerInfo | null) => {
    customerInfoRef.current = info;
    setCustomerInfoState(info);
  }, []);
  // When the store last confirmed Pro (settleAfterStore); 0 = never.
  const storeConfirmedAtRef = useRef(0);
  // One request in flight per (reason, user): concurrent callers (the boot
  // effect and a screen asking at the same moment, two mismatch handlers)
  // share it instead of hitting the API twice for the same answer. Keyed on
  // the user too, so a sign_in sync still in flight for user A is not handed
  // to user B (the stale-session guard would resolve it to null and leave B
  // unresolved).
  const inflightRef = useRef(new Map<string, Promise<boolean | null>>());

  const runSync = useCallback(
    async (reason: EntitlementSyncReason, userId: string): Promise<boolean | null> => {
      const active = await fetchServerEntitlement(reason);
      if (active === null) {
        trackEntitlementSyncFailed({ reason });
        return null;
      }
      try {
        // The answer is about the user who was signed in when we asked. If
        // the session changed or ended mid-flight (sign-out, fast re-sign-in
        // as someone else) it must not become the new user's verdict.
        const { data } = await supabase.auth.getSession();
        if (data.session?.user.id !== userId) return null;
      } catch {
        return null;
      }
      const devicePro = isProActive(customerInfoRef.current);
      if (devicePro !== active) {
        trackEntitlementMismatch({ reason, device_pro: devicePro, server_active: active });
      }
      if (!active && devicePro && Date.now() - storeConfirmedAtRef.current < STORE_GRACE_MS) {
        // Inside the post-store grace window (see STORE_GRACE_MS) a server
        // "false" never downgrades, whatever the reason: the verdict set in
        // settleAfterStore stands and the cache is left alone. Bouncing a
        // user who just paid to the paywall is the worse failure. Direct
        // callers still get the server's answer.
        return false;
      }
      setEntitled(active);
      void writeCachedEntitlement(active);
      return active;
    },
    [],
  );

  const syncEntitlement = useCallback(
    async (reason: EntitlementSyncReason): Promise<boolean | null> => {
      let userId: string;
      try {
        // No session: nothing to be entitled as. Also keeps the anonymous
        // teaser from firing an authenticated request that a 401 would turn
        // into a "session expired" bounce.
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setEntitled(false);
          return false;
        }
        userId = data.session.user.id;
      } catch {
        return null;
      }
      const key = `${reason}:${userId}`;
      const existing = inflightRef.current.get(key);
      if (existing) return existing;
      const inflight = runSync(reason, userId).finally(() => {
        if (inflightRef.current.get(key) === inflight) inflightRef.current.delete(key);
      });
      inflightRef.current.set(key, inflight);
      return inflight;
    },
    [runSync],
  );

  // Boot: configure once, align identity to the current session, wire the
  // listener, then resolve `entitled` (cache first, the server given
  // BOOT_VERDICT_CAP_MS to overrule it, then the offline fallback).
  useEffect(() => {
    const configured = configurePurchases();
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      let info: CustomerInfo | null = null;
      let cached: boolean | null = null;
      try {
        if (configured) {
          const { data } = await supabase.auth.getSession();
          const userId = data.session?.user.id;
          const [rcInfo, off] = await Promise.all([
            userId ? identifyPurchasesUser(userId) : fetchCustomerInfo(),
            fetchCurrentOffering(),
          ]);
          if (cancelled) return;
          info = rcInfo;
          setCustomerInfo(info);
          setOffering(off);
          unsubscribe = addCustomerInfoListener(setCustomerInfo);
        }

        cached = await readCachedEntitlement();
        if (cancelled) return;
        if (cached !== null) setEntitled(cached);
        // `ready` waits for the server or the cap, whichever comes first (see
        // BOOT_VERDICT_CAP_MS). A no-session answer is immediate.
        const server = await withinMs(syncEntitlement('boot'), BOOT_VERDICT_CAP_MS);
        if (cancelled) return;
        if (server === null && cached === null) {
          // Offline (or past the cap) on a launch with no cached verdict:
          // one of the two places the phone's RevenueCat state is used as a
          // verdict rather than a hint (the other is a confirmed
          // purchase/restore, settleAfterStore), so a subscriber without
          // signal isn't bounced to the paywall. Functional update: a slow
          // server answer that landed meanwhile wins over the fallback, and
          // one that lands later replaces it.
          setEntitled((current) => current ?? isProActive(info));
        }
        setReady(true);
      } catch (err) {
        // Nothing above is expected to throw (the seams swallow their own
        // errors), but the app must never sit on the splash forever: resolve
        // a verdict from whatever we got (cache, else device, else false)
        // and become ready.
        console.warn('[purchases] boot failed', err instanceof Error ? err.message : err);
        const cachedNow = cached ?? (await readCachedEntitlement());
        if (cancelled) return;
        setEntitled((current) => current ?? cachedNow ?? isProActive(info));
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [setCustomerInfo, syncEntitlement]);

  // Keep RevenueCat identity in lockstep with auth. logIn/logOut as the user
  // signs in/out so entitlements follow the account, not the device.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const info = await identifyPurchasesUser(session.user.id);
        if (info) setCustomerInfo(info);
        // Unconditional: a returning user's server row may exist while this
        // device's SDK is fresh (reinstall, new phone), and a subscription
        // RevenueCat transferred to this account on logIn needs the server
        // told before the first search.
        void syncEntitlement('sign_in');
      } else if (event === 'SIGNED_OUT') {
        // Drop the verdict and cache first, synchronously: a fast re-sign-in
        // can land its own verdict while the RevenueCat logout below is
        // still in flight, and that must not be overwritten afterwards. The
        // in-flight syncs and the post-store grace window belong to the user
        // who just left, not the next one.
        setEntitled(false);
        void clearCachedEntitlement();
        inflightRef.current.clear();
        storeConfirmedAtRef.current = 0;
        await logoutPurchasesUser();
        setCustomerInfo(await fetchCustomerInfo());
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [setCustomerInfo, syncEntitlement]);

  const refresh = useCallback(async () => {
    setCustomerInfo(await fetchCustomerInfo());
  }, [setCustomerInfo]);

  const refreshOffering = useCallback(async (): Promise<PurchasesOffering | null> => {
    const off = await fetchCurrentOffering();
    // Keep a previously loaded offering rather than blanking prices on a
    // transient failure.
    if (off) setOffering(off);
    return off;
  }, []);

  // After RevenueCat reports Pro right out of the StoreKit flow: this is the
  // second and last place the device's verdict counts (the first is the
  // offline boot fallback). The user just paid, so `entitled` flips to true
  // immediately and is cached, and the caller gets `true` whatever the
  // server says; otherwise a stalled sync (or a server still lagging the
  // purchase) would leave the paywall's `if (!isPro) return` holding a
  // charged user on the paywall, or let payment.tsx navigate into the tabs
  // only for the layout to bounce them straight back. The capped server
  // sync then runs so the server learns about it; its answer only feeds
  // `entitled`, the mismatch event, and the cache (and, inside
  // STORE_GRACE_MS, can only confirm, never downgrade). Past the cap we
  // navigate anyway; the still-running sync and the search screen's
  // mismatch handler finish the job.
  const settleAfterStore = useCallback(
    async (info: CustomerInfo | null, reason: 'purchase' | 'restore'): Promise<boolean> => {
      const pro = isProActive(info);
      if (!pro) return false;
      storeConfirmedAtRef.current = Date.now();
      setEntitled(true);
      void writeCachedEntitlement(true);
      await withinMs(syncEntitlement(reason), POST_PURCHASE_SYNC_CAP_MS);
      return pro;
    },
    [syncEntitlement],
  );

  const purchase = useCallback(
    async (pkg: PurchasesPackage, source: string): Promise<boolean> => {
      const { outcome, customerInfo: info } = await rcPurchasePackage(pkg);
      trackPaywallResult({ source, outcome });
      if (!info) return false;
      setCustomerInfo(info);
      return settleAfterStore(info, 'purchase');
    },
    [setCustomerInfo, settleAfterStore],
  );

  const presentPaywall = useCallback(
    async (source: string): Promise<boolean> => {
      trackPaywallShown({ source });
      const outcome = await rcPresentPaywall();
      trackPaywallResult({ source, outcome });
      const info = await fetchCustomerInfo();
      setCustomerInfo(info);
      return settleAfterStore(info, outcome === 'restored' ? 'restore' : 'purchase');
    },
    [setCustomerInfo, settleAfterStore],
  );

  const presentCustomerCenter = useCallback(async (): Promise<void> => {
    trackCustomerCenterOpened();
    await rcPresentCustomerCenter();
    // Customer Center can change state (cancel, restore, refund) - re-read.
    setCustomerInfo(await fetchCustomerInfo());
  }, [setCustomerInfo]);

  const restore = useCallback(async (): Promise<boolean> => {
    const info = await rcRestore();
    setCustomerInfo(info);
    trackPurchasesRestored({ is_pro: isProActive(info) });
    return settleAfterStore(info, 'restore');
  }, [setCustomerInfo, settleAfterStore]);

  const value: PurchasesContextValue = {
    ready,
    entitled,
    isPro: isProActive(customerInfo),
    isLapsed: hasLapsedEntitlement(customerInfo),
    customerInfo,
    offering,
    syncEntitlement,
    refresh,
    refreshOffering,
    purchase,
    presentPaywall,
    presentCustomerCenter,
    restore,
  };

  return <PurchasesContext.Provider value={value}>{children}</PurchasesContext.Provider>;
}

export function usePurchases(): PurchasesContextValue {
  const ctx = useContext(PurchasesContext);
  if (!ctx) {
    throw new Error('usePurchases must be used within a PurchasesProvider');
  }
  return ctx;
}
