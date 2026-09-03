import { supabase } from './supabase';
import { syncSubscription } from './apiClient';

/**
 * Push the device's RevenueCat state to the server (POST
 * /api/subscriptions/sync) so the next data request is served unlocked
 * instead of racing the RevenueCat webhook - or, for a subscription that
 * RevenueCat transferred to this account from another, so the server learns
 * about it at all.
 *
 * Best effort: resolves to the server's verdict, or `null` when the sync
 * didn't happen (no session, network/HTTP failure). Never throws.
 *
 * Skips the call entirely without a Supabase session: the locked teaser is
 * reachable anonymously by design, and an authenticated 401 would otherwise
 * be treated as "session expired" (token wiped, bounced to the problem
 * screen) by the shared API client.
 */
export async function syncServerEntitlement(): Promise<{ active: boolean } | null> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return null;
    const { active } = await syncSubscription();
    return { active };
  } catch (err) {
    console.warn('[entitlementSync] sync failed', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * `syncServerEntitlement` capped at `ms`: for the post-purchase path, where
 * the user has just paid and is waiting to get in. Normally the sync is a
 * sub-second round trip and the first search lands unlocked; on a stalled
 * connection we navigate anyway and let the search screen's own mismatch
 * self-heal finish the job.
 */
export function syncServerEntitlementWithin(ms: number): Promise<{ active: boolean } | null> {
  return Promise.race([
    syncServerEntitlement(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}
