/**
 * RevenueCat React context.
 *
 * Mounts once near the root (see app/_layout.tsx). It:
 *   1. configures the SDK,
 *   2. keeps the RevenueCat app-user-id aligned with the Supabase session,
 *   3. holds the latest CustomerInfo and exposes `isPro` derived from it,
 *   4. live-updates via the SDK's CustomerInfo listener (renewals, refunds,
 *      purchases made outside the app), and
 *   5. exposes paywall / customer-center / restore actions.
 *
 * Screens consume `usePurchases()` / `usePro()` — they never import
 * `lib/purchases.ts` (the native seam) directly.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import { supabase } from './supabase';
import { syncServerEntitlement, syncServerEntitlementWithin } from './entitlementSync';
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
  trackPaywallResult,
  trackPaywallShown,
  trackPurchasesRestored,
} from './analytics';

// Post-purchase/restore: the user has just paid and is waiting to get in, so
// the server sync is capped - normally sub-second, and the first search then
// lands unlocked; past the cap we navigate anyway and the search screen's
// mismatch self-heal finishes the job.
const POST_PURCHASE_SYNC_CAP_MS = 4000;

export interface PurchasesContextValue {
  /** True once configure + first CustomerInfo read have settled. */
  ready: boolean;
  /** True when the `pro` entitlement is active. */
  isPro: boolean;
  /** True when `pro` was active before but has lapsed (cancelled/expired) — see `hasLapsedEntitlement`. */
  isLapsed: boolean;
  customerInfo: CustomerInfo | null;
  /** Current offering — its `.annual`/`.monthly` packages back the in-app paywall. */
  offering: PurchasesOffering | null;
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
   * (e.g. 'onboarding', 'profile'). Resolves to the Pro state afterwards.
   */
  purchase: (pkg: PurchasesPackage, source: string) => Promise<boolean>;
  /**
   * Present the RevenueCat paywall. `source` tags the analytics event
   * (e.g. 'onboarding', 'profile'). Resolves to the Pro state afterwards.
   */
  presentPaywall: (source: string) => Promise<boolean>;
  /** Present the Customer Center (manage / cancel / restore / refund). */
  presentCustomerCenter: () => Promise<void>;
  /** Restore prior purchases. Resolves to the Pro state afterwards. */
  restore: () => Promise<boolean>;
}

const PurchasesContext = createContext<PurchasesContextValue | undefined>(undefined);

export function PurchasesProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);

  // Configure once, align identity to the current session, wire the listener.
  useEffect(() => {
    const ok = configurePurchases();
    if (!ok) {
      setReady(true);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      const [info, off] = await Promise.all([
        userId ? identifyPurchasesUser(userId) : fetchCustomerInfo(),
        fetchCurrentOffering(),
      ]);
      if (cancelled) return;
      setCustomerInfo(info);
      setOffering(off);
      unsubscribe = addCustomerInfoListener(setCustomerInfo);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Keep RevenueCat identity in lockstep with auth. logIn/logOut as the user
  // signs in/out so entitlements follow the account, not the device.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const info = await identifyPurchasesUser(session.user.id);
        if (info) setCustomerInfo(info);
        // A returning subscriber on a new account (RevenueCat transferred the
        // store subscription to this app user on logIn) - make sure the
        // server knows before the first search.
        if (isProActive(info)) void syncServerEntitlement();
      } else if (event === 'SIGNED_OUT') {
        await logoutPurchasesUser();
        setCustomerInfo(await fetchCustomerInfo());
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    setCustomerInfo(await fetchCustomerInfo());
  }, []);

  const refreshOffering = useCallback(async (): Promise<PurchasesOffering | null> => {
    const off = await fetchCurrentOffering();
    // Keep a previously loaded offering rather than blanking prices on a
    // transient failure.
    if (off) setOffering(off);
    return off;
  }, []);

  const purchase = useCallback(async (pkg: PurchasesPackage, source: string): Promise<boolean> => {
    const { outcome, customerInfo: info } = await rcPurchasePackage(pkg);
    trackPaywallResult({ source, outcome });
    if (info) {
      setCustomerInfo(info);
      const pro = isProActive(info);
      if (pro) await syncServerEntitlementWithin(POST_PURCHASE_SYNC_CAP_MS);
      return pro;
    }
    return false;
  }, []);

  const presentPaywall = useCallback(async (source: string): Promise<boolean> => {
    trackPaywallShown({ source });
    const outcome = await rcPresentPaywall();
    trackPaywallResult({ source, outcome });
    const info = await fetchCustomerInfo();
    setCustomerInfo(info);
    const pro = isProActive(info);
    if (pro) await syncServerEntitlementWithin(POST_PURCHASE_SYNC_CAP_MS);
    return pro;
  }, []);

  const presentCustomerCenter = useCallback(async (): Promise<void> => {
    trackCustomerCenterOpened();
    await rcPresentCustomerCenter();
    // Customer Center can change state (cancel, restore, refund) — re-sync.
    setCustomerInfo(await fetchCustomerInfo());
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    const info = await rcRestore();
    setCustomerInfo(info);
    const pro = isProActive(info);
    trackPurchasesRestored({ is_pro: pro });
    if (pro) await syncServerEntitlementWithin(POST_PURCHASE_SYNC_CAP_MS);
    return pro;
  }, []);

  const value: PurchasesContextValue = {
    ready,
    isPro: isProActive(customerInfo),
    isLapsed: hasLapsedEntitlement(customerInfo),
    customerInfo,
    offering,
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

/** Convenience selector for gating UI on Pro access. */
export function usePro(): boolean {
  return usePurchases().isPro;
}
