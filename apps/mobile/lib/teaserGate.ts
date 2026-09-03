import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { supabase } from './supabase';
import { fetchCustomerInfo, hasLapsedEntitlement } from './purchases';

const PREVIEW_SAMPLE_USED_KEY = '@fitsy/previewSampleUsed';

// In-memory mirror of the persisted flag: reads after the first one are
// free (no bridge round-trip on every locked-row tap), and mark/reset flip
// it synchronously with the storage write in the background.
let sampleUsedCache: boolean | null = null;

/**
 * Whether this device has already spent its one free restaurant-detail view
 * for the current onboarding pass (or lapsed-subscriber / declined-paywall
 * browse). Persisted so backgrounding or killing the app mid-flow can't
 * reset it; a *new* onboarding pass (welcome/preview-intro) does reset it.
 *
 * This is a UX gate only, not a security boundary - it bounds how many free
 * *looks* a well-behaved client offers, not how much data a client can pull.
 * The server's own redaction (locked list rows, truncated menu items) is what
 * actually limits how much real data an unentitled caller can get, and holds
 * regardless of this flag.
 */
export async function hasUsedPreviewSample(): Promise<boolean> {
  if (sampleUsedCache !== null) return sampleUsedCache;
  try {
    sampleUsedCache = (await AsyncStorage.getItem(PREVIEW_SAMPLE_USED_KEY)) === '1';
  } catch {
    // Storage read failure - fail open to "not used" rather than trapping the
    // caller out of the teaser; worst case they get an extra free look.
    sampleUsedCache = false;
  }
  return sampleUsedCache;
}

/** Fresh onboarding pass = fresh tease. Sync in memory; the storage write
 * is fire-and-forget (a failure just means the look stays spent on disk). */
export function resetPreviewSample(): void {
  sampleUsedCache = false;
  AsyncStorage.removeItem(PREVIEW_SAMPLE_USED_KEY).catch(() => {});
}

/** Sync in memory; storage write is fire-and-forget (a failure just means
 * the device gets more than one free look, which the server-side redaction
 * still bounds). */
export function markPreviewSampleUsed(): void {
  sampleUsedCache = true;
  AsyncStorage.setItem(PREVIEW_SAMPLE_USED_KEY, '1').catch(() => {});
}

// Coarse in-flight guard: a fast double-tap on the same locked row/CTA would
// otherwise fire two independent navigations (two overlapping getSession()
// calls, two router.push calls) before either resolves.
let navigating = false;

/**
 * Sends a locked-out browser to the right paywall entry point:
 * - no session: account creation (sign-in), which then flows through the
 *   normal post-signup onboarding tail into payment - payment itself
 *   assumes an authenticated user, so it can't be the direct target;
 * - signed in with a *lapsed* entitlement: the win-back screen
 *   (welcome/resubscribe), never the first-time paywall - that one promises
 *   a free trial Apple won't grant a second time to the same Apple ID;
 * - signed in, never subscribed (declined every offer): the paywall.
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
  let target: '/welcome/payment' | '/welcome/resubscribe' | '/welcome/signin' = '/welcome/signin';
  try {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        // fetchCustomerInfo is null when RevenueCat isn't configured or the
        // read fails - treated as "never subscribed", i.e. the paywall.
        target = hasLapsedEntitlement(await fetchCustomerInfo()) ? '/welcome/resubscribe' : '/welcome/payment';
      }
    } catch {
      // Fall through with the sign-in default set above.
    }
    if (replace) router.replace(target);
    else router.push(target);
  } finally {
    navigating = false;
  }
}
