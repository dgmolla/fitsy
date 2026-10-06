import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateAge } from '../../../packages/shared/src/utils/dateUtils';
import { calculateRecommendedCalories } from '../../../packages/shared/src/utils/macroTargets';
import type { TriedApproach } from './onboardingPersonalization';

const KEY = '@fitsy/onboarding';

export type ActivityLevel = 'sedentary' | 'lightly_active' | 'active' | 'very_active';
export type Goal = 'lose_fat' | 'maintain' | 'build_muscle' | 'performance';
export type Sex = 'female' | 'male';

export interface OnboardingArea { lat: number; lng: number; name: string; source: 'gps' | 'manual' | 'saved' }

export interface OnboardingData {
  tried?: TriedApproach;
  area?: OnboardingArea;
  targetMode?: 'known' | 'estimate';
  targetChoiceInProgress?: boolean;
  targetBasis?: string;
  previewCraving?: string;
  previewArea?: string;
  birthday?: string;
  heightCm?: number;
  weightKg?: number;
  sex?: Sex;
  activity?: ActivityLevel;
  goal?: Goal;
  dietary?: string[];
}

let pendingWrite: Promise<void> = Promise.resolve();

export async function saveOnboardingField<K extends keyof OnboardingData>(
  field: K,
  value: OnboardingData[K],
): Promise<void> {
  const write = pendingWrite.catch(() => {}).then(async () => {
    const existing = await getOnboardingData();
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...existing, [field]: value }));
  });
  pendingWrite = write;
  return write;
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
