/**
 * Entitlement helpers: the pure, framework-free half of "is this user
 * allowed in?".
 *
 * The SERVER is the single source of truth for entitlement. The phone's
 * RevenueCat CustomerInfo is only a fast hint that triggers a sync. The
 * backend classifies "lapsed" vs "never subscribed". The one place that
 * decides and stores the verdict is `syncEntitlement` in usePurchases.tsx;
 * this module gives it the transport, the cache, and the resolution rule,
 * each testable without React.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSubscriptionStatus, syncSubscription, type SubscriptionStatusResult, type SubscriptionSyncReason } from './apiClient';

/**
 * Why a sync is being asked for. `boot` is a cheap DB read of the server's
 * stored row; every other reason makes the server re-read RevenueCat, because
 * something just happened (a purchase, a restore, a sign-in, or a locked
 * response while we believed the user was Pro) that the stored row may not
 * reflect yet.
 */
export type EntitlementSyncReason = 'boot' | SubscriptionSyncReason;

/** Last server verdict, scoped to the Fitsy user and bounded by its RC proof. */
export const ENTITLEMENT_CACHE_KEY = '@fitsy/entitlement';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type CachedEntitlement = Pick<SubscriptionStatusResult,
  'active' | 'verdict' | 'expiresAt' | 'lastRcVerifiedAt'>;

export async function readCachedEntitlement(userId: string): Promise<CachedEntitlement | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as CachedEntitlement & { userId?: string };
    const verified = cache.lastRcVerifiedAt ? Date.parse(cache.lastRcVerifiedAt) : NaN;
    if (cache.userId !== userId ||
        !['active', 'expired', 'never_subscribed'].includes(cache.verdict) ||
        cache.active !== (cache.verdict === 'active') ||
        !Number.isFinite(verified) ||
        Date.now() - verified > CACHE_MAX_AGE_MS || verified > Date.now() + 60_000 ||
        (cache.verdict === 'active' && cache.expiresAt &&
          (typeof cache.expiresAt !== 'string' || !Number.isFinite(Date.parse(cache.expiresAt)) ||
            Date.parse(cache.expiresAt) <= Date.now()))) return null;
    return cache;
  } catch {
    return null;
  }
}

export async function writeCachedEntitlement(userId: string, status: SubscriptionStatusResult): Promise<void> {
  try {
    if (status.verdict === 'unknown' || status.stale || !status.lastRcVerifiedAt) return;
    await AsyncStorage.setItem(ENTITLEMENT_CACHE_KEY, JSON.stringify({
      userId, active: status.verdict === 'active', verdict: status.verdict,
      expiresAt: status.expiresAt, lastRcVerifiedAt: status.lastRcVerifiedAt,
    }));
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
export async function fetchServerEntitlement(reason: EntitlementSyncReason): Promise<SubscriptionStatusResult | null> {
  try {
    const result = reason === 'boot' ? await fetchSubscriptionStatus() : await syncSubscription(reason);
    if (result.verdict !== 'active' && result.verdict !== 'expired' &&
        result.verdict !== 'never_subscribed' && result.verdict !== 'unknown') return null;
    return result;
  } catch (err) {
    console.warn('[entitlement] sync failed', reason, err instanceof Error ? err.message : err);
    return null;
  }
}
