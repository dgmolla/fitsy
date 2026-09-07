import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushProfileToServer } from './profileSync';
import { getOnboardingData } from './onboardingStorage';
import { trackOnboardingCompleted } from './analytics';

export const ONBOARDING_COMPLETE_KEY = 'onboardingComplete';
export const DISCOUNT_APPLIED_KEY = 'discountApplied';

/**
 * Record onboarding as finished: the flag, the discount marker, the profile
 * push and the `onboarding_completed` event. Idempotent: the paywall can be
 * re-entered by a user who already finished (a lock CTA tapped while the
 * server row still lags a purchase, a stale cached verdict), and its
 * entitled-redirect would otherwise re-run all of this and double-count the
 * event. Resolves to whether this call did the recording.
 */
export async function recordOnboardingComplete(discounted: boolean): Promise<boolean> {
  if ((await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)) === 'true') return false;
  await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
  if (discounted) await AsyncStorage.setItem(DISCOUNT_APPLIED_KEY, 'true');
  pushProfileToServer();
  const d = await getOnboardingData();
  trackOnboardingCompleted({
    goal: d.goal,
    activity_level: d.activity,
    has_weight: d.weightKg !== undefined,
    has_height: d.heightCm !== undefined,
  });
  return true;
}
