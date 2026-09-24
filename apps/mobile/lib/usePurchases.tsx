/** Root RevenueCat context. Screens consume usePurchases; server entitlement gates access. */
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
import { usePurchaseActions } from './usePurchaseActions';
import { usePurchaseIntroEligibility } from './usePurchaseIntroEligibility';
import { withinMs } from './async';
import type { EntitlementSyncReason } from './entitlement';
import { BOOT_VERDICT_CAP_MS, useEntitlementVerdict } from './useEntitlementVerdict';
import { useAuthLifecycle } from './useAuthLifecycle';
import {
  addCustomerInfoListener,
  configurePurchases,
  currentPurchasesUserId,
  fetchCurrentOffering,
  fetchCustomerInfo,
  hasLapsedEntitlement,
  identifyPurchasesUser,
  isProActive,
  showManageSubscriptions as rcShowManageSubscriptions,
} from './purchases';

export { BOOT_VERDICT_CAP_MS, STORE_GRACE_MS } from './useEntitlementVerdict';

export { POST_PURCHASE_SYNC_CAP_MS, PURCHASE_IDENTITY_CAP_MS } from './usePurchaseActions';
export { INTRO_ELIGIBILITY_CAP_MS } from './usePurchaseIntroEligibility';

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
  // Mirror of `customerInfo` for async callbacks (the boot sync runs before
  // the first render that would carry it in state).
  const customerInfoRef = useRef<CustomerInfo | null>(null);
  const customerInfoGenerationRef = useRef(0);
  const customerInfoLastWriteRef = useRef<'boot' | 'listener' | 'other'>('other');
  const customerInfoReadRequestRef = useRef(0);
  const listenerReadSequenceRef = useRef(0);
  const listenerCommittedSequenceRef = useRef(0);
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
  const setCustomerInfo = useCallback((info: CustomerInfo | null, source: 'boot' | 'listener' | 'other' = 'other') => {
    customerInfoGenerationRef.current += 1;
    customerInfoLastWriteRef.current = source;
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
    const bootInfoRequest = ++customerInfoReadRequestRef.current;
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
            if (sameUser && !isCancelled() &&
              customerInfoGenerationRef.current === bootInfoGeneration &&
              customerInfoReadRequestRef.current === bootInfoRequest) {
              setCustomerInfo(info, 'boot');
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
          // A queued update from the previous native identity must not
          // invalidate this account's still-pending boot read.
          const readSequence = ++listenerReadSequenceRef.current;
          for (;;) {
            const infoGeneration = customerInfoGenerationRef.current;
            // The event payload can belong to the previous account if auth
            // changed while the callback was queued. Read the verified identity.
            const fresh = await fetchCustomerInfo();
            if (!fresh) return;
            const latest = await supabase.auth.getSession();
            const nativeUserId = await currentPurchasesUserId();
            if (latest.data.session?.user.id !== currentUserId || nativeUserId !== currentUserId ||
                readSequence <= listenerCommittedSequenceRef.current) return;
            if (customerInfoGenerationRef.current !== infoGeneration) {
              // Boot or another listener committed while this read was pending.
              // Its response may predate that commit, so ask the SDK again.
              if (customerInfoLastWriteRef.current === 'other') return;
              continue;
            }
            listenerCommittedSequenceRef.current = readSequence;
            ++customerInfoReadRequestRef.current;
            const proChanged = isProActive(fresh) !== isProActive(customerInfoRef.current);
            setCustomerInfo(fresh, 'listener');
            if (proChanged) void syncEntitlement('mismatch');
            return;
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

  const { introEligibility, introEligibilityReady } = usePurchaseIntroEligibility({
    offering, customerInfo, customerInfoSettled, entitled,
  });

  const { purchase, presentPaywall, restore } = usePurchaseActions({
    setCustomerInfo, markStoreConfirmed, syncEntitlement,
  });

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
