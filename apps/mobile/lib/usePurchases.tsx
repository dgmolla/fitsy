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
import type { CustomerInfo } from 'react-native-purchases';
import { supabase } from './supabase';
import {
  addCustomerInfoListener,
  configurePurchases,
  fetchCustomerInfo,
  identifyPurchasesUser,
  isProActive,
  logoutPurchasesUser,
  presentCustomerCenter as rcPresentCustomerCenter,
  presentPaywall as rcPresentPaywall,
  restorePurchases as rcRestore,
} from './purchases';
import {
  trackCustomerCenterOpened,
  trackPaywallResult,
  trackPaywallShown,
  trackPurchasesRestored,
} from './analytics';

export interface PurchasesContextValue {
  /** True once configure + first CustomerInfo read have settled. */
  ready: boolean;
  /** True when the `pro` entitlement is active. */
  isPro: boolean;
  customerInfo: CustomerInfo | null;
  /** Re-fetch CustomerInfo from RevenueCat. */
  refresh: () => Promise<void>;
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
      const info = userId
        ? await identifyPurchasesUser(userId)
        : await fetchCustomerInfo();
      if (cancelled) return;
      setCustomerInfo(info);
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

  const presentPaywall = useCallback(async (source: string): Promise<boolean> => {
    trackPaywallShown({ source });
    const outcome = await rcPresentPaywall();
    trackPaywallResult({ source, outcome });
    const info = await fetchCustomerInfo();
    setCustomerInfo(info);
    return isProActive(info);
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
    return pro;
  }, []);

  const value: PurchasesContextValue = {
    ready,
    isPro: isProActive(customerInfo),
    customerInfo,
    refresh,
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
