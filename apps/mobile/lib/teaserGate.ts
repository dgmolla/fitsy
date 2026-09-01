import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { supabase } from './supabase';

const PREVIEW_SAMPLE_USED_KEY = '@fitsy/previewSampleUsed';

/**
 * Whether this device has already spent its one free restaurant-detail view
 * from the locked search teaser (onboarding, a lapsed subscriber, or someone
 * who declined every payment offer). Persisted so leaving the app mid-flow
 * can't reset it.
 */
export async function hasUsedPreviewSample(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREVIEW_SAMPLE_USED_KEY)) === '1';
  } catch {
    // Storage read failure — fail open to "not used" rather than trapping the
    // caller out of the teaser; the server-side lock is the real boundary.
    return false;
  }
}

export async function markPreviewSampleUsed(): Promise<void> {
  try {
    await AsyncStorage.setItem(PREVIEW_SAMPLE_USED_KEY, '1');
  } catch {
    // Non-fatal — worst case the device gets more than one free sample,
    // which the server-side redaction still bounds regardless.
  }
}

/**
 * Sends a locked-out browser to the right paywall entry point: account
 * creation first for a brand-new visitor (who then flows through the normal
 * post-signup onboarding tail into payment), or straight to the paywall for
 * someone who already has a session but isn't subscribed (a lapsed
 * subscriber, or someone who declined every offer). Payment itself assumes
 * an authenticated user, so a session-less caller must go through sign-in
 * first rather than being sent there directly.
 *
 * `replace: true` swaps the current screen instead of pushing on top of it —
 * use this when leaving a screen that's "spent" (e.g. the one free detail
 * view) so backing out of the paywall doesn't land the user back on it.
 */
export async function routeToPaywall(options: { replace?: boolean } = {}): Promise<void> {
  const replace = options.replace ?? false;
  let target: '/welcome/payment' | '/welcome/signin' = '/welcome/signin';
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) target = '/welcome/payment';
  } catch {
    // Session check failed (offline, Supabase hiccup) — default to sign-in;
    // an already-authenticated user just re-confirms there, which is safe.
  }
  if (replace) router.replace(target);
  else router.push(target);
}
