import { useCallback } from 'react';
import { Alert } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { supabase } from './supabase';
import { withinMs } from './async';
import type { EntitlementSyncReason } from './entitlement';
import { ensurePurchasesUser, fetchCustomerInfo, isProActive, presentPaywall as rcPresentPaywall,
  purchasePackage as rcPurchasePackage, restorePurchases as rcRestore } from './purchases';
import { trackPaywallResult, trackPaywallShown, trackPurchasesRestored } from './analytics';

export const POST_PURCHASE_SYNC_CAP_MS = 4000;
export const PURCHASE_IDENTITY_CAP_MS = 5000;

export function usePurchaseActions({ setCustomerInfo, markStoreConfirmed, syncEntitlement }: {
  setCustomerInfo: (info: CustomerInfo | null) => void;
  markStoreConfirmed: () => void;
  syncEntitlement: (reason: EntitlementSyncReason) => Promise<boolean | null>;
}) {
  // After RevenueCat reports Pro right out of the StoreKit flow: the user
  // just paid, so `entitled` flips true immediately (cached) and the caller
  // gets `true` whatever the server says; otherwise a stalled or lagging
  // sync would hold a charged user on the paywall (`if (!isPro) return`) or
  // let the tabs layout bounce them back. The capped sync then tells the
  // server; its answer only feeds `entitled`, the mismatch event and the
  // cache (inside STORE_GRACE_MS it can only confirm). Past the cap we
  // navigate anyway; the sync and the search screen's mismatch handler finish.
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
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      const identified = userId
        ? await withinMs(ensurePurchasesUser(userId), PURCHASE_IDENTITY_CAP_MS)
        : false;
      if (identified === null) {
        // The native identity request is still unresolved. Its queue must
        // remain intact so a late login cannot race a new account or purchase.
        Alert.alert('Payment service still connecting', 'Fully close and reopen Fitsy, then try again.');
        return false;
      }
      if (!userId || !identified) {
        Alert.alert('Purchase not available', 'We could not confirm your account with the store. Please try again.');
        return false;
      }
      const isCurrentUser = async () => (await supabase.auth.getSession()).data.session?.user.id === userId;
      if (!(await isCurrentUser())) return false;
      const { outcome, customerInfo: info } = await rcPurchasePackage(pkg, userId, isCurrentUser);
      trackPaywallResult({ source, outcome });
      if (outcome === 'error') Alert.alert('Purchase not completed', 'Please try again. You can also restore an existing subscription.');
      if (!info) return false;
      if (!(await isCurrentUser())) return false;
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

  const restore = useCallback(async (): Promise<boolean | null> => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    const identified = userId
      ? await withinMs(ensurePurchasesUser(userId), PURCHASE_IDENTITY_CAP_MS)
      : false;
    if (identified === null) {
      Alert.alert('Payment service still connecting', 'Fully close and reopen Fitsy, then try again.');
      return null;
    }
    if (!userId || !identified) {
      Alert.alert('Restore not available', 'We could not confirm your account with the store. Please try again.');
      return null;
    }
    const isCurrentUser = async () => (await supabase.auth.getSession()).data.session?.user.id === userId;
    if (!(await isCurrentUser())) return null;
    const info = await rcRestore(userId, isCurrentUser);
    if (!(await isCurrentUser())) return null;
    if (!info) {
      Alert.alert('Restore not completed', 'Please try again.');
      return null;
    }
    setCustomerInfo(info);
    trackPurchasesRestored({ is_pro: isProActive(info) });
    return settleAfterStore(info, 'restore');
  }, [setCustomerInfo, settleAfterStore]);

  return { purchase, presentPaywall, restore };
}
