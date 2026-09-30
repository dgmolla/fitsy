import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import type { EntitlementSyncReason } from './entitlement';

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
  /** True when the account-bound backend verdict is `expired`. */
  isLapsed: boolean;
  /** The backend could not yet establish this account's subscription history. */
  isUnknown: boolean;
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
  purchase: (pkg: PurchasesPackage, source: string, attribution?: { paywall_variant: 'A' | 'B'; paywall_config_version: string }) => Promise<boolean>;
  /** Present the RevenueCat paywall. `source` tags analytics. Resolves like `purchase`. */
  presentPaywall: (source: string) => Promise<boolean>;
  /** Open the owning store's subscription management when known. */
  showManageSubscriptions: () => Promise<void>;
  /** The store confirmed a purchase/restore within the last STORE_GRACE_MS. */
  storeConfirmed: boolean;
  /** True for Pro, false for a completed restore with no Pro, null if restore could not complete. */
  restore: () => Promise<boolean | null>;
}
