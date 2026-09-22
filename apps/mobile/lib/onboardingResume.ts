import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { getMacroTargets } from './macroStorage';
import { getPreviewSetup } from './previewSetup';

const KEY = '@fitsy/onboardingStep';
const STEPS = ['promise', 'tried', 'response', 'value-payoff', 'location-permission', 'value-abundance', 'how-it-works', 'target-setup', 'macros-intro', 'goal', 'height', 'weight', 'age', 'sex', 'activity', 'tuning', 'preview', 'signin', 'trial', 'payment', 'out-of-area'] as const;
type Step = typeof STEPS[number];
export function useOnboardingStep(step?: Step): void {
  useFocusEffect(useCallback(() => { if (step) void AsyncStorage.setItem(KEY, step); }, [step]));
}
export async function getOnboardingResume(): Promise<`/welcome/${Step}` | null> {
  const step = await AsyncStorage.getItem(KEY);
  // Earlier versions asked about prior approaches before collecting location.
  if ((step === 'tried' || step === 'response') && !(await getPreviewSetup()).data.area) return '/welcome/location-permission';
  if (step === 'trial') return '/welcome/payment';
  if (step === 'value-abundance') return '/welcome/value-payoff';
  // The old flow showed nutrition trust before targets; the new flow follows them.
  if (step === 'how-it-works' && !(await getMacroTargets())) return '/welcome/target-setup';
  return step && STEPS.includes(step as Step) ? `/welcome/${step as Step}` : null;
}
export async function clearOnboardingResume(): Promise<void> { await AsyncStorage.removeItem(KEY); }
