/**
 * RevenueCat integration — framework-agnostic core.
 *
 * This module owns every direct call into `react-native-purchases` /
 * `react-native-purchases-ui`. UI code talks to RevenueCat exclusively through
 * the React context in `usePurchases.tsx`, which in turn calls this file. Keep
 * it that way: one seam to the native SDK makes the whole thing mockable and
 * keeps entitlement logic out of screens.
 *
 * Source of truth for "is this user paying?" is RevenueCat, read client-side
 * via `customerInfo.entitlements.active`. The backend is synced separately by
 * the RevenueCat webhook (apps/api) for server-trusted checks — the client does
 * NOT validate receipts itself.
 *
 * Keys are read from `app.config.ts` → `extra.revenueCat`, which pulls from
 * EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY. We never
 * hardcode the key (see the env-reliability convention in the repo).
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

/**
 * Entitlement identifier — MUST match the entitlement configured in the
 * RevenueCat dashboard exactly (case-sensitive). Display name there is
 * "Fitsy Pro"; the identifier is the lowercase conventional `pro`.
 */
export const ENTITLEMENT_ID = 'pro';

export interface RevenueCatKeys {
  ios?: string;
  android?: string;
  /**
   * RevenueCat Test Store key (`test_…`). Used in dev builds ONLY: it drives the
   * simulate-purchase modal in the simulator with no App Store Connect needed,
   * and entitlements update just like production. A RELEASE build that configures
   * with a `test_` key intentionally crashes (RevenueCat hard-stop to keep test
   * purchases out of prod), so we must never select it outside `__DEV__`.
   */
  test?: string;
}

/** Pure per-platform store-key selection — unit-testable without the SDK. */
export function pickApiKey(os: typeof Platform.OS, keys: RevenueCatKeys): string | undefined {
  if (os === 'ios') return keys.ios;
  if (os === 'android') return keys.android;
  return undefined;
}

/**
 * Resolve which key to configure with: the Test Store key in dev (so purchases
 * are testable in the simulator), the real per-platform store key otherwise
 * (TestFlight/sandbox + production both use the store key). Pure + unit-testable.
 */
export function resolveApiKey(
  os: typeof Platform.OS,
  isDev: boolean,
  keys: RevenueCatKeys,
): string | undefined {
  if (isDev && keys.test) return keys.test;
  return pickApiKey(os, keys);
}

function readKeys(): RevenueCatKeys {
  const extra = (Constants.expoConfig?.extra ?? {}) as { revenueCat?: RevenueCatKeys };
  return extra.revenueCat ?? {};
}

let configured = false;

export function isPurchasesConfigured(): boolean {
  return configured;
}

/**
 * Configure the SDK exactly once. Returns false (and no-ops) when no key is
 * present for the current platform — e.g. running in Expo Go, on web, or before
 * the keys are pasted into env — so the app still boots instead of crashing.
 */
export function configurePurchases(): boolean {
  if (configured) return true;
  const apiKey = resolveApiKey(Platform.OS, __DEV__, readKeys());
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn(
      `[purchases] No RevenueCat key for "${Platform.OS}". Set ` +
        'EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ' +
        'and rebuild the dev client. Subscriptions are disabled this session.',
    );
    return false;
  }
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
  Purchases.configure({ apiKey });
  configured = true;
  return true;
}

/** Pure entitlement check — the single definition of "is Pro". */
export function isProActive(
  info: CustomerInfo | null | undefined,
  entitlementId: string = ENTITLEMENT_ID,
): boolean {
  if (!info) return false;
  return info.entitlements.active[entitlementId] !== undefined;
}

/**
 * True when the user has a past record of this entitlement (RevenueCat keeps
 * expired/cancelled entitlements in `entitlements.all`) but it isn't active
 * now — i.e. they subscribed before and lapsed, as opposed to never having
 * subscribed at all (no record in `.all`). Used to route lapsed users to a
 * dedicated win-back screen instead of the generic first-time paywall, since
 * that paywall promises a free trial Apple won't grant a second time to the
 * same Apple ID.
 */
export function hasLapsedEntitlement(
  info: CustomerInfo | null | undefined,
  entitlementId: string = ENTITLEMENT_ID,
): boolean {
  if (!info) return false;
  if (info.entitlements.active[entitlementId] !== undefined) return false;
  return info.entitlements.all[entitlementId] !== undefined;
}

// ─── Identity ───────────────────────────────────────────────────────────────
// We alias the RevenueCat app-user-id to the Supabase user id so entitlements
// follow the account across devices and reinstalls (rather than living on an
// anonymous, device-local id).

export async function identifyPurchasesUser(userId: string): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    const { customerInfo } = await Purchases.logIn(userId);
    return customerInfo;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[purchases] logIn failed', err);
    return null;
  }
}

export async function logoutPurchasesUser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // logOut throws when the current user is already anonymous — expected, ignore.
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function fetchCustomerInfo(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[purchases] getCustomerInfo failed', err);
    return null;
  }
}

export async function fetchOfferings(): Promise<PurchasesOfferings | null> {
  if (!configured) return null;
  try {
    return await Purchases.getOfferings();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[purchases] getOfferings failed', err);
    return null;
  }
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    return await Purchases.restorePurchases();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[purchases] restorePurchases failed', err);
    return null;
  }
}

/**
 * The current offering (the one marked current in the dashboard). Its
 * `.annual` / `.monthly` packages back our in-app paywall (apps render their
 * own UI and call purchasePackage, rather than using a RevenueCat-hosted
 * paywall — keeps the paywall on Fitsy's design system, no dashboard design).
 */
export async function fetchCurrentOffering(): Promise<PurchasesOffering | null> {
  const offerings = await fetchOfferings();
  return offerings?.current ?? null;
}

export type PurchaseOutcome = 'purchased' | 'cancelled' | 'error';

/** Pure: classify a purchase exception as a user-cancel vs a real error. */
export function interpretPurchaseError(err: unknown): Exclude<PurchaseOutcome, 'purchased'> {
  if (
    err &&
    typeof err === 'object' &&
    (err as { userCancelled?: boolean | null }).userCancelled
  ) {
    return 'cancelled';
  }
  return 'error';
}

/**
 * Buy a package. Returns the outcome plus fresh CustomerInfo on success so the
 * caller can immediately re-derive entitlement state. Never throws — a user
 * cancel is a normal 'cancelled' outcome, not an error.
 */
export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<{ outcome: PurchaseOutcome; customerInfo: CustomerInfo | null }> {
  if (!configured) return { outcome: 'error', customerInfo: null };
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { outcome: 'purchased', customerInfo };
  } catch (err) {
    const outcome = interpretPurchaseError(err);
    if (outcome === 'error') {
      // eslint-disable-next-line no-console
      console.warn('[purchases] purchasePackage failed', err);
    }
    return { outcome, customerInfo: null };
  }
}

/**
 * Subscribe to live entitlement changes (e.g. a purchase made in the App Store,
 * a renewal, or a refund). Returns an unsubscribe fn.
 */
export function addCustomerInfoListener(cb: (info: CustomerInfo) => void): () => void {
  Purchases.addCustomerInfoUpdateListener(cb);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(cb);
  };
}

// ─── Paywall + Customer Center (RevenueCatUI) ─────────────────────────────────

export type PaywallOutcome = 'purchased' | 'restored' | 'cancelled' | 'not_presented' | 'error';

/** Pure mapping from the SDK enum to our normalized outcome — unit-testable. */
export function mapPaywallResult(result: PAYWALL_RESULT): PaywallOutcome {
  switch (result) {
    case PAYWALL_RESULT.PURCHASED:
      return 'purchased';
    case PAYWALL_RESULT.RESTORED:
      return 'restored';
    case PAYWALL_RESULT.CANCELLED:
      return 'cancelled';
    case PAYWALL_RESULT.NOT_PRESENTED:
      return 'not_presented';
    case PAYWALL_RESULT.ERROR:
    default:
      return 'error';
  }
}

/**
 * Present the RevenueCat-hosted paywall for the current offering. The offering
 * and its paywall are configured in the dashboard, so pricing/copy/AB-tests
 * change without an app release.
 */
export async function presentPaywall(): Promise<PaywallOutcome> {
  try {
    const result = await RevenueCatUI.presentPaywall();
    return mapPaywallResult(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[purchases] presentPaywall failed', err);
    return 'error';
  }
}

/** Present the paywall only if the user lacks the entitlement. */
export async function presentPaywallIfNeeded(
  entitlementId: string = ENTITLEMENT_ID,
): Promise<PaywallOutcome> {
  try {
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: entitlementId,
    });
    return mapPaywallResult(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[purchases] presentPaywallIfNeeded failed', err);
    return 'error';
  }
}

/** Present the RevenueCat Customer Center (manage plan, restore, refunds, surveys). */
export async function presentCustomerCenter(): Promise<void> {
  try {
    await RevenueCatUI.presentCustomerCenter();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[purchases] presentCustomerCenter failed', err);
  }
}
