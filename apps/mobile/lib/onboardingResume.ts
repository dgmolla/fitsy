import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

const KEY = '@fitsy/onboardingStep';
const STEPS = ['promise', 'tried', 'response', 'location-permission', 'value-abundance', 'how-it-works', 'target-setup', 'macros-intro', 'goal', 'height', 'weight', 'age', 'sex', 'activity', 'tuning', 'preview', 'signin', 'trial', 'payment', 'out-of-area'] as const;
type Step = typeof STEPS[number];
export function useOnboardingStep(step?: Step): void {
  useFocusEffect(useCallback(() => { if (step) void AsyncStorage.setItem(KEY, step); }, [step]));
}
export async function getOnboardingResume(): Promise<`/welcome/${Step}` | null> {
  const step = await AsyncStorage.getItem(KEY);
  return step && STEPS.includes(step as Step) ? `/welcome/${step as Step}` : null;
}
export async function clearOnboardingResume(): Promise<void> { await AsyncStorage.removeItem(KEY); }
