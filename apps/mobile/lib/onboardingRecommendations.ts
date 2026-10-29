import { calculateAge } from '@fitsy/shared/utils/dateUtils';
import { calculateRecommendedCalories } from '@fitsy/shared/utils/macroTargets';
import type { OnboardingData } from './onboardingStorage';

/** Profile math has no storage, authentication or native initialization. */
export function calculateSuggestedCalories(data: OnboardingData): number {
  return calculateRecommendedCalories({
    age: data.birthday ? calculateAge(data.birthday) : undefined,
    heightCm: data.heightCm,
    weightKg: data.weightKg,
    sex: data.sex,
    activityLevel: data.activity,
    goal: data.goal,
  });
}
