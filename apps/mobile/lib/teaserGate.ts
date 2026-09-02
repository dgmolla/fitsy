import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { supabase } from './supabase';

const PREVIEW_SAMPLE_USED_KEY = '@fitsy/previewSampleUsed';

/**
 * Whether this device has already spent its one free restaurant-detail view
 * from the locked search teaser (onboarding, a lapsed subscriber, or someone
 * who declined every payment offer). Persisted so leaving the app mid-flow
 * can't reset it.
 *
 * This is a UX gate only, not a security boundary - it bounds how many free
 * *looks* a well-behaved client offers, not how much data a client can pull.
 * The server's own redaction (locked list rows, truncated menu items) is what
 * actually limits how much real data an unentitled caller can get, and holds
 * regardless of this flag (e.g. a cleared app / reinstalled device just gets
 * more free looks, never more real data per look).
 */
export async function hasUsedPreviewSample(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREVIEW_SAMPLE_USED_KEY)) === '1';
  } catch {
    // Storage read failure - fail open to "not used" rather than trapping the
    // caller out of the teaser; worst case they get an extra free look.
    return false;
  }
}

/** Fresh onboarding pass = fresh tease: clears a free look spent in an
 * earlier session (re-onboarding after sign-out, testing) so it can't gate
 * a brand-new walkthrough. */
export async function resetPreviewSample(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREVIEW_SAMPLE_USED_KEY);
  } catch {
    // Non-fatal - worst case the free look stays spent for this pass.
  }
}

export async function markPreviewSampleUsed(): Promise<void> {
  try {
    await AsyncStorage.setItem(PREVIEW_SAMPLE_USED_KEY, '1');
  } catch {
    // Non-fatal - worst case the device gets more than one free look, which
    // the server-side redaction still bounds regardless.
  }
}

// Coarse in-flight guard: a fast double-tap on the same locked row/CTA would
// otherwise fire two independent navigations (two overlapping getSession()
// calls, two router.push calls) before either resolves.
let navigating = false;

/**
 * Sends a locked-out browser to the right paywall entry point: account
 * creation first for a brand-new visitor (who then flows through the normal
 * post-signup onboarding tail into payment), or straight to the paywall for
 * someone who already has a session but isn't subscribed (a lapsed
 * subscriber, or someone who declined every offer). Payment itself assumes
 * an authenticated user, so a session-less caller must go through sign-in
 * first rather than being sent there directly.
 *
 * `replace: true` swaps the current screen instead of pushing on top of it -
 * use this when leaving a screen that's "spent" (e.g. the one free detail
 * view) so backing out of the paywall doesn't land the user back on it.
 */
export async function routeToPaywall(options: { replace?: boolean } = {}): Promise<void> {
  if (navigating) return;
  navigating = true;
  const replace = options.replace ?? false;
  // Default to sign-in on a failed session check - most locked-teaser
  // visitors are anonymous (onboarding), not a signed-in lapsed subscriber,
  // so this is the more common correct outcome, not a guaranteed-safe one:
  // an authenticated user hitting this branch would have to re-authenticate
  // rather than landing straight on payment.
  let target: '/welcome/payment' | '/welcome/signin' = '/welcome/signin';
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) target = '/welcome/payment';
  } catch {
    // Fall through with the sign-in default set above.
  }
  if (replace) router.replace(target);
  else router.push(target);
  navigating = false;
}
