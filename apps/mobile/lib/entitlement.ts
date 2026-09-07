/**
 * Entitlement helpers: the pure, framework-free half of "is this user
 * allowed in?".
 *
 * The SERVER is the single source of truth for entitlement. The phone's
 * RevenueCat CustomerInfo is only a fast hint that triggers a sync (and the
 * copy source for "lapsed" vs "never subscribed"). The one place that
 * decides and stores the verdict is `syncEntitlement` in usePurchases.tsx;
 * this module gives it the transport, the cache, and the resolution rule,
 * each testable without React.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSubscriptionStatus, syncSubscription, type SubscriptionSyncReason } from './apiClient';

/**
 * Why a sync is being asked for. `boot` is a cheap DB read of the server's
 * stored row; every other reason makes the server re-read RevenueCat, because
 * something just happened (a purchase, a restore, a sign-in, or a locked
 * response while we believed the user was Pro) that the stored row may not
 * reflect yet.
 */
export type EntitlementSyncReason = 'boot' | SubscriptionSyncReason;

/** Last server verdict, persisted so the next launch can gate instantly. */
export const ENTITLEMENT_CACHE_KEY = '@fitsy/entitlement';

export async function readCachedEntitlement(): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

export async function writeCachedEntitlement(active: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ENTITLEMENT_CACHE_KEY, active ? 'true' : 'false');
  } catch {
    // Best effort: a failed cache write only costs a slower next boot.
  }
}

export async function clearCachedEntitlement(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ENTITLEMENT_CACHE_KEY);
  } catch {
    // Same as above.
  }
}

/**
 * Ask the server for its verdict. Resolves to `null` when the request failed
 * (network, HTTP error): the caller keeps whatever it already believed.
 * Never throws. Callers must already have checked for a Supabase session:
 * an authenticated 401 is treated as "session expired" by the API client
 * (token wiped, bounced to the problem screen), which is the wrong outcome
 * for an anonymous teaser visitor.
 */
export async function fetchServerEntitlement(reason: EntitlementSyncReason): Promise<boolean | null> {
  try {
    const { active } = reason === 'boot' ? await fetchSubscriptionStatus() : await syncSubscription(reason);
    return active;
  } catch (err) {
    console.warn('[entitlement] sync failed', reason, err instanceof Error ? err.message : err);
    return null;
  }
}
