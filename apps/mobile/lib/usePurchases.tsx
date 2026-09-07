/**
 * RevenueCat React context.
 *
 * Mounts once near the root (see app/_layout.tsx). It:
 *   1. configures the SDK,
 *   2. keeps the RevenueCat app-user-id aligned with the Supabase session,
 *   3. holds the latest CustomerInfo and exposes `isPro` / `isLapsed`
 *      derived from it (hints and copy, never a gate),
 *   4. composes `useEntitlementVerdict`, which owns `entitled` (the SERVER's
 *      verdict, the thing screens gate on) and `syncEntitlement`, and
 *   5. exposes paywall / manage-subscription / restore actions.
 *
 * Screens consume `usePurchases()`; they never import `lib/purchases.ts`
 * (the native seam) directly.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import { supabase } from './supabase';
import { withinMs } from './async';
import type { EntitlementSyncReason } from './entitlement';
import { useEntitlementVerdict } from './useEntitlementVerdict';
import {
  addCustomerInfoListener,
  configurePurchases,
  fetchCurrentOffering,
  fetchCustomerInfo,
  hasLapsedEntitlement,
  identifyPurchasesUser,
  isProActive,
  logoutPurchasesUser,
  presentPaywall as rcPresentPaywall,
  purchasePackage as rcPurchasePackage,
  restorePurchases as rcRestore,
  showManageSubscriptions as rcShowManageSubscriptions,
} from './purchases';
import { trackPaywallResult, trackPaywallShown, trackPurchasesRestored } from './analytics';

export { BOOT_VERDICT_CAP_MS, STORE_GRACE_MS } from './useEntitlementVerdict';

// Post-purchase/restore: the user has just paid and is waiting to get in, so
// the server sync is capped - normally sub-second, and the first search then
// lands unlocked; past the cap we navigate on the device's verdict and the
// search screen's mismatch handler finishes the job.
export const POST_PURCHASE_SYNC_CAP_MS = 4000;

export interface PurchasesContextValue {
  /** `entitled !== null`: the verdict has settled on this launch. */
  ready: boolean;
  /**
   * The server's verdict: may this user use the app? `null` while unsettled
   * (boot, sign-in, sign-out in progress). This is what gates screens;
   * `isPro` is not.
   */
  entitled: boolean | null;
  /** Device hint: RevenueCat says the `pro` entitlement is active. */
  isPro: boolean;
  /** True when `pro` was active before but has lapsed - see `hasLapsedEntitlement`. */
  isLapsed: boolean;
  customerInfo: CustomerInfo | null;
  /** Current offering; its `.annual`/`.monthly` packages back the in-app paywall. */
  offering: PurchasesOffering | null;
  /**
   * Ask the server for its verdict and store it. Resolves to the verdict now
   * in effect; `null` when it couldn't be asked (`entitled` unchanged);
   * `false` without a Supabase session, with no request made.
   */
  syncEntitlement: (reason: EntitlementSyncReason) => Promise<boolean | null>;
  /** Re-fetch CustomerInfo from RevenueCat. */
  refresh: () => Promise<void>;
  /**
   * Re-fetch the current offering. The boot fetch can fail (offline at
   * launch, StoreKit hiccup); paywalls call this rather than showing "plans
   * are still loading" until relaunch. Resolves to the offering so callers
   * can retry a purchase in one step.
   */
  refreshOffering: () => Promise<PurchasesOffering | null>;
  /**
   * Buy a package from our own paywall UI. `source` tags analytics (e.g.
   * 'onboarding', 'profile'). Resolves to true whenever the store flow
   * confirmed Pro (and sets `entitled` true) - see settleAfterStore.
   */
  purchase: (pkg: PurchasesPackage, source: string) => Promise<boolean>;
  /** Present the RevenueCat paywall. `source` tags analytics. Resolves like `purchase`. */
  presentPaywall: (source: string) => Promise<boolean>;
  /** Open the App Store's manage-subscriptions sheet (URL fallback inside). */
  showManageSubscriptions: () => Promise<void>;
  restore: () => Promise<boolean>; // resolves like `purchase`
}

const PurchasesContext = createContext<PurchasesContextValue | undefined>(undefined);

export function PurchasesProvider({ children }: { children: React.ReactNode }) {
  const [customerInfo, setCustomerInfoState] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  // Mirror of `customerInfo` for async callbacks (the boot sync runs before
  // the first render that would carry it in state).
  const customerInfoRef = useRef<CustomerInfo | null>(null);
  const setCustomerInfo = useCallback((info: CustomerInfo | null) => {
    customerInfoRef.current = info;
    setCustomerInfoState(info);
  }, []);
  // The user the boot effect identified, so a SIGNED_IN that supabase-js
  // emits while recovering that same session on cold start is not treated
  // as a fresh sign-in (boot owns that resolution).
  const bootUserIdRef = useRef<string | null>(null);
  const verdict = useEntitlementVerdict({ customerInfoRef });
  const {
    entitled,
    entitledRef,
    syncEntitlement,
    resolveAtBoot,
    settleAfterBootFailure,
    resolveAfterSignIn,
    markStoreConfirmed,
    beginSignOut,
    settleAfterSignOut,
  } = verdict;

  // Boot: one session read, then the RevenueCat identify/offering and the
  // verdict's cache read + capped server fetch all run in parallel; the
  // verdict folds once the RevenueCat read is in (see resolveAtBoot).
  useEffect(() => {
    const configured = configurePurchases();
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    const isCancelled = () => cancelled;

    (async () => {
      let userId: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        userId = data.session?.user.id;
        bootUserIdRef.current = userId ?? null;
        const rcReady = (async (): Promise<CustomerInfo | null> => {
          if (!configured) return null;
          const [info, off] = await Promise.all([
            userId ? identifyPurchasesUser(userId) : fetchCustomerInfo(),
            fetchCurrentOffering(),
          ]);
          if (cancelled) return info;
          setCustomerInfo(info);
          setOffering(off);
          unsubscribe = addCustomerInfoListener(setCustomerInfo);
          return info;
        })();
        await resolveAtBoot(userId, rcReady, isCancelled);
      } catch (err) {
        // The seams swallow their own errors, but no gate may hold forever.
        console.warn('[purchases] boot failed', err instanceof Error ? err.message : err);
        await settleAfterBootFailure(userId, isCancelled);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [setCustomerInfo, resolveAtBoot, settleAfterBootFailure]);

  // Keep RevenueCat identity in lockstep with auth. logIn/logOut as the user
  // signs in/out so entitlements follow the account, not the device.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Session recovery on cold start re-emits SIGNED_IN for the user the
        // boot effect already identified and resolved: nothing to do.
        if (session.user.id === bootUserIdRef.current && entitledRef.current !== null) return;
        await resolveAfterSignIn(async () => {
          const info = await identifyPurchasesUser(session.user.id);
          if (info) setCustomerInfo(info);
          return info;
        });
        // From here a duplicate SIGNED_IN for this user is a no-op too.
        bootUserIdRef.current = session.user.id;
      } else if (event === 'SIGNED_OUT') {
        bootUserIdRef.current = null;
        beginSignOut();
        await logoutPurchasesUser();
        setCustomerInfo(await fetchCustomerInfo());
        await settleAfterSignOut();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [setCustomerInfo, entitledRef, resolveAfterSignIn, beginSignOut, settleAfterSignOut]);

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

  // After RevenueCat reports Pro right out of the StoreKit flow: the user
  // just paid, so `entitled` flips true immediately (cached) and the caller
  // gets `true` whatever the server says; otherwise a stalled or lagging
  // sync would leave the paywall's `if (!isPro) return` holding a charged
  // user on the paywall, or let the tabs layout bounce them back. The capped
  // sync then tells the server; its answer only feeds `entitled`, the
  // mismatch event, and the cache (and, inside STORE_GRACE_MS, can only
  // confirm, never downgrade). Past the cap we navigate anyway; the
  // still-running sync and the search screen's mismatch handler finish.
  const settleAfterStore = useCallback(
    async (info: CustomerInfo | null, reason: 'purchase' | 'restore'): Promise<boolean> => {
      const pro = isProActive(info);
      if (!pro) return false;
      markStoreConfirmed();
      await withinMs(syncEntitlement(reason), POST_PURCHASE_SYNC_CAP_MS);
      return pro;
    },
    [markStoreConfirmed, syncEntitlement],
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

  const restore = useCallback(async (): Promise<boolean> => {
    const info = await rcRestore();
    setCustomerInfo(info);
    trackPurchasesRestored({ is_pro: isProActive(info) });
    return settleAfterStore(info, 'restore');
  }, [setCustomerInfo, settleAfterStore]);

  const value = useMemo<PurchasesContextValue>(
    () => ({
      ready: entitled !== null,
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
      showManageSubscriptions: rcShowManageSubscriptions,
      restore,
    }),
    [entitled, customerInfo, offering, syncEntitlement, refresh, refreshOffering, purchase, presentPaywall, restore],
  );

  return <PurchasesContext.Provider value={value}>{children}</PurchasesContext.Provider>;
}

export function usePurchases(): PurchasesContextValue {
  const ctx = useContext(PurchasesContext);
  if (!ctx) {
    throw new Error('usePurchases must be used within a PurchasesProvider');
  }
  return ctx;
}
