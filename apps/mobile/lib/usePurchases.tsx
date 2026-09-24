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
 *      `useAuthLifecycle`, which follows Supabase sign-in / sign-out, and
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
import { Alert } from 'react-native';
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import { supabase } from './supabase';
import { withinMs } from './async';
import type { EntitlementSyncReason } from './entitlement';
import { BOOT_VERDICT_CAP_MS, useEntitlementVerdict } from './useEntitlementVerdict';
import { useAuthLifecycle } from './useAuthLifecycle';
import {
  addCustomerInfoListener,
  configurePurchases,
  currentPurchasesUserId,
  fetchCurrentOffering,
  fetchIntroEligibility,
  fetchCustomerInfo,
  hasLapsedEntitlement,
  ensurePurchasesUser,
  identifyPurchasesUser,
  isProActive,
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
export const INTRO_ELIGIBILITY_CAP_MS = 5000;
export const PURCHASE_IDENTITY_CAP_MS = 5000;

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
  /** Empty while checking, or when the store cannot establish eligibility. */
  introEligibility: Record<string, boolean>;
  /** True after eligibility settles, times out, or CustomerInfo is unavailable. */
  introEligibilityReady: boolean;
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
  /** The store confirmed a purchase/restore within the last STORE_GRACE_MS. */
  storeConfirmed: boolean;
  /** True for Pro, false for a completed restore with no Pro, null if restore could not complete. */
  restore: () => Promise<boolean | null>;
}

const PurchasesContext = createContext<PurchasesContextValue | undefined>(undefined);

export function PurchasesProvider({ children }: { children: React.ReactNode }) {
  const [customerInfo, setCustomerInfoState] = useState<CustomerInfo | null>(null);
  const [customerInfoSettled, setCustomerInfoSettled] = useState(false);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [introResult, setIntroResult] = useState<{
    info: CustomerInfo; offering: PurchasesOffering; values: Record<string, boolean>;
  } | null>(null);
  // Mirror of `customerInfo` for async callbacks (the boot sync runs before
  // the first render that would carry it in state).
  const customerInfoRef = useRef<CustomerInfo | null>(null);
  const customerInfoGenerationRef = useRef(0);
  const configuredRef = useRef(false);
  const offeringRequestRef = useRef(0);
  const offeringCommittedRequestRef = useRef(0);
  const acceptOffering = useCallback((off: PurchasesOffering | null, request: number) => {
    // A failed retry cannot cancel an older successful catalog read.
    // Among successful reads, the newest request owns the visible plans.
    if (off && request > offeringCommittedRequestRef.current) {
      offeringCommittedRequestRef.current = request;
      setOffering(off);
    }
  }, []);
  const setCustomerInfo = useCallback((info: CustomerInfo | null) => {
    customerInfoGenerationRef.current += 1;
    customerInfoRef.current = info;
    setCustomerInfoState(info);
    setCustomerInfoSettled(true);
  }, []);
  const verdict = useEntitlementVerdict({ customerInfoRef });
  const { entitled, inStoreGrace, syncEntitlement, resolveAtBoot, settleAfterBootFailure, markStoreConfirmed } = verdict;
  const auth = useAuthLifecycle({ verdict, setCustomerInfo });

  // Boot: the offering loads independently of the bounded identity and
  // verdict reads. A stalled store catalog must not hold every gate.
  useEffect(() => {
    const configured = configurePurchases();
    configuredRef.current = configured;
    const bootInfoGeneration = customerInfoGenerationRef.current;
    let cancelled = false;
    let bootOpen = true;
    let bootUserId: string | undefined;
    const isCancelled = () => cancelled || !auth.isBootCurrent(bootUserId);
    auth.beginBoot();

    (async () => {
      let userId: string | undefined;
      try {
        const sessionRead = supabase.auth.getSession();
        const sessionResult = await withinMs(sessionRead, BOOT_VERDICT_CAP_MS);
        if (!sessionResult) {
          void sessionRead.then(async ({ data }) => {
            if (cancelled || !data.session) return;
            const current = await supabase.auth.getSession();
            if (!cancelled && current.data.session?.user.id === data.session.user.id) {
              auth.resumeLateBootUser(data.session.user.id);
            }
          }).catch(() => undefined);
        }
        userId = sessionResult?.data.session?.user.id;
        bootUserId = userId;
        auth.markBootUser(userId);
        if (configured) {
          const offeringRequest = ++offeringRequestRef.current;
          void fetchCurrentOffering().then(off => {
            if (!cancelled) acceptOffering(off, offeringRequest);
          }).catch(() => undefined);
        }
        const rcReady = configured
          ? (userId ? identifyPurchasesUser(userId) : fetchCustomerInfo()).then(async info => {
            if (isCancelled()) return info;
            // Once boot has closed, auth may have moved to another account.
            const sameUser = bootOpen || await supabase.auth.getSession().then(
              ({ data }) => data.session?.user.id === userId,
              () => false,
            );
            if (sameUser && !isCancelled() && customerInfoGenerationRef.current === bootInfoGeneration) {
              setCustomerInfo(info);
              if (!bootOpen && isProActive(info) && verdict.entitledRef.current === false) {
                void syncEntitlement('mismatch');
              }
            }
            return info;
          })
          : Promise.resolve(null);
        await resolveAtBoot(userId, rcReady, isCancelled);
        if (!cancelled) setCustomerInfoSettled(true);
      } catch (err) {
        // The seams swallow their own errors, but no gate may hold forever.
        console.warn('[purchases] boot failed', err instanceof Error ? err.message : err);
        if (!cancelled) setCustomerInfoSettled(true);
        await settleAfterBootFailure(userId, isCancelled);
      } finally {
        bootOpen = false;
        auth.finishBoot(cancelled);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setCustomerInfo, acceptOffering, resolveAtBoot, settleAfterBootFailure, syncEntitlement, verdict.entitledRef, auth]);

  // Mount independently of the boot identity read. A sign-in can invalidate
  // that read, but must not leave this provider without native updates.
  useEffect(() => {
    if (!configuredRef.current) return;
    try {
      return addCustomerInfoListener(() => {
        void (async () => {
          const { data } = await supabase.auth.getSession();
          const currentUserId = data.session?.user.id;
          if (!currentUserId || await currentPurchasesUserId() !== currentUserId) return;
          // The event payload can belong to the previous account if auth
          // changed while the callback was queued. Read the verified identity.
          const fresh = await fetchCustomerInfo();
          if (!fresh) return;
          const latest = await supabase.auth.getSession();
          if (latest.data.session?.user.id === currentUserId &&
            await currentPurchasesUserId() === currentUserId) {
            const proChanged = isProActive(fresh) !== isProActive(customerInfoRef.current);
            setCustomerInfo(fresh);
            if (proChanged) void syncEntitlement('mismatch');
          }
        })().catch(() => undefined);
      });
    } catch (err) {
      console.warn('[purchases] listener unavailable', err instanceof Error ? err.message : err);
    }
  }, [setCustomerInfo, syncEntitlement]);

  const refresh = useCallback(async () => {
    setCustomerInfo(await fetchCustomerInfo());
  }, [setCustomerInfo]);

  const refreshOffering = useCallback(async (): Promise<PurchasesOffering | null> => {
    const offeringRequest = ++offeringRequestRef.current;
    const off = await fetchCurrentOffering();
    // Keep a previously loaded offering rather than blanking prices on a
    // transient failure.
    acceptOffering(off, offeringRequest);
    return off;
  }, [acceptOffering]);

  useEffect(() => {
    let current = true;
    if (offering && customerInfo) {
      void withinMs(fetchIntroEligibility(offering.availablePackages.map(pkg => pkg.product.identifier)), INTRO_ELIGIBILITY_CAP_MS).catch(() => null).then(values => {
        if (current) setIntroResult({ info: customerInfo, offering, values: values ?? {} });
      });
    }
    return () => { current = false; };
  }, [offering, customerInfo]);

  // Reject an earlier account/offering result during the render before effects run.
  const introEligibility = useMemo(() =>
    introResult?.info === customerInfo && introResult?.offering === offering ? introResult.values : {},
  [introResult, customerInfo, offering]);
  // CustomerInfo can fail independently of the offering. Unknown eligibility
  // must lead to plan review without presenting a trial or hanging this route.
  const introEligibilityReady = !!offering && (customerInfo
    ? introResult?.info === customerInfo && introResult?.offering === offering
    : customerInfoSettled && entitled !== null);

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

  // Time-based, so read on every render and let the memo key on the result.
  const storeConfirmed = inStoreGrace();
  const value = useMemo<PurchasesContextValue>(
    () => ({
      ready: entitled !== null,
      entitled,
      storeConfirmed,
      isPro: isProActive(customerInfo),
      isLapsed: hasLapsedEntitlement(customerInfo),
      customerInfo,
      offering,
      introEligibility,
      introEligibilityReady,
      syncEntitlement,
      refresh,
      refreshOffering,
      purchase,
      presentPaywall,
      showManageSubscriptions: rcShowManageSubscriptions,
      restore,
    }),
    [entitled, storeConfirmed, customerInfo, offering, introEligibility, introEligibilityReady, syncEntitlement, refresh, refreshOffering, purchase, presentPaywall, restore],
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
