import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@fitsy/onboarding';

export type ActivityLevel = 'sedentary' | 'lightly_active' | 'active' | 'very_active';
export type Goal = 'lose_fat' | 'maintain' | 'build_muscle';

export interface OnboardingData {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  activity?: ActivityLevel;
  goal?: Goal;
}

export async function saveOnboardingField<K extends keyof OnboardingData>(
  field: K,
  value: OnboardingData[K],
): Promise<void> {
  const existing = await getOnboardingData();
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...existing, [field]: value }));
}

export async function getOnboardingData(): Promise<OnboardingData> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as OnboardingData;
  } catch {
    return {};
  }
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  active: 1.55,
  very_active: 1.725,
};

const GOAL_ADJUSTMENTS: Record<Goal, number> = {
  lose_fat: -500,
  maintain: 0,
  build_muscle: 250,
};

// Mifflin-St Jeor BMR averaged across sexes (no sex field collected)
function calcBMR(weightKg: number, heightCm: number, age: number): number {
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age - 78);
}

export function calculateSuggestedCalories(data: OnboardingData): number {
  const { age = 25, heightCm = 170, weightKg = 75, activity = 'lightly_active', goal = 'maintain' } = data;
  const bmr = calcBMR(weightKg, heightCm, age);
  const tdee = Math.round(bmr * ACTIVITY_MULTIPLIERS[activity]);
  const adjusted = tdee + GOAL_ADJUSTMENTS[goal];
  return Math.max(1200, Math.min(3500, adjusted));
}
