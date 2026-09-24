import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { getMacroTargets } from './macroStorage';
import { getOnboardingData } from './onboardingStorage';
import { getPreviewSetup } from './previewSetup';

const KEY = '@fitsy/onboardingStep';
const GOAL_RETURN_KEY = '@fitsy/onboardingGoalReturnTo';
type GoalReturnTo = '/welcome/value-payoff' | '/welcome/goal-payoff' | '/welcome/target-setup' | '/macro-setup' | '/macro-setup?fromOnboarding=1';
const STEPS = ['promise', 'tried', 'response', 'value-payoff', 'goal-payoff', 'location-permission', 'value-abundance', 'how-it-works', 'target-setup', 'macros-intro', 'goal', 'height', 'weight', 'age', 'sex', 'activity', 'tuning', 'preview', 'signin', 'trial', 'trial-reminder', 'payment', 'out-of-area'] as const;
type Step = typeof STEPS[number];
export function useOnboardingStep(step?: Step): void {
  useFocusEffect(useCallback(() => { if (step) void AsyncStorage.setItem(KEY, step); }, [step]));
}
export async function getOnboardingResume(): Promise<`/welcome/${Step}` | null> {
  const step = await AsyncStorage.getItem(KEY);
  // Earlier versions asked about prior approaches before collecting location.
  if ((step === 'tried' || step === 'response') && !(await getPreviewSetup()).data.area) return '/welcome/location-permission';
  if (step === 'promise') return '/welcome/location-permission';
  // Earlier onboarding asked about prior approaches before the goal choice.
  // A resumed payoff must collect that choice before showing a goal-specific graph.
  if ((step === 'value-abundance' || step === 'value-payoff' || step === 'goal-payoff') && !(await getOnboardingData()).goal) {
    await rememberGoalReturnTo(step === 'goal-payoff' ? '/welcome/goal-payoff' : '/welcome/value-payoff');
    return '/welcome/goal';
  }
  if (step && ['how-it-works', 'target-setup', 'macros-intro', 'height', 'weight', 'age', 'sex', 'activity', 'tuning', 'preview'].includes(step) && !(await getOnboardingData()).goal) {
    await rememberGoalReturnTo('/welcome/target-setup');
    return '/welcome/goal';
  }
  if (step === 'value-abundance') return '/welcome/value-payoff';
  // The old flow showed nutrition trust before targets; the new flow follows them.
  if (step === 'how-it-works' && !(await getMacroTargets())) return '/welcome/target-setup';
  return step && STEPS.includes(step as Step) ? `/welcome/${step as Step}` : null;
}
export async function rememberGoalReturnTo(destination: GoalReturnTo): Promise<void> {
  await AsyncStorage.setItem(GOAL_RETURN_KEY, destination);
}

export async function takeGoalReturnTo(): Promise<GoalReturnTo | null> {
  const saved = await AsyncStorage.getItem(GOAL_RETURN_KEY);
  await AsyncStorage.removeItem(GOAL_RETURN_KEY);
  return saved === '/welcome/value-payoff' || saved === '/welcome/goal-payoff' || saved === '/welcome/target-setup' || saved === '/macro-setup' || saved === '/macro-setup?fromOnboarding=1' ? saved : null;
}

export async function clearGoalReturnTo(): Promise<void> {
  await AsyncStorage.removeItem(GOAL_RETURN_KEY);
}

export async function clearOnboardingResume(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  await AsyncStorage.removeItem(GOAL_RETURN_KEY);
}
