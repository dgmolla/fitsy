import { router } from 'expo-router';
import { supabase } from './supabase';

/**
 * A store purchase or restore must run under a signed-in Supabase user:
 * RevenueCat is keyed to that user id, and the webhook maps the purchase to
 * the server's Subscription row through it. If auth-js dropped the session
 * while the paywall sat open (SIGNED_OUT fires, nothing navigates), letting
 * StoreKit proceed would charge the user under an anonymous RevenueCat id
 * the server can never map. Sends them to sign in instead (the same target
 * lib/teaserGate uses for session-less callers). Resolves to whether the
 * store flow may proceed.
 */
export async function ensureSessionForPurchase(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return true;
  router.replace('/welcome/signin');
  return false;
}
