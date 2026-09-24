import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { getMacroTargets } from './macroStorage';
import { getOnboardingData } from './onboardingStorage';
import { getPreviewSetup } from './previewSetup';

const KEY = '@fitsy/onboardingStep';
const GOAL_RETURN_KEY = '@fitsy/onboardingGoalReturnTo';
export type GoalReturnTo = '/welcome/tried' | '/welcome/response' | '/welcome/value-payoff' | '/welcome/goal-payoff' | '/welcome/target-setup' | '/macro-setup' | '/macro-setup?fromOnboarding=1';
const STEPS = ['promise', 'tried', 'response', 'value-payoff', 'goal-payoff', 'location-permission', 'value-abundance', 'how-it-works', 'target-setup', 'macros-intro', 'goal', 'height', 'weight', 'age', 'sex', 'activity', 'tuning', 'preview', 'signin', 'trial', 'trial-reminder', 'payment', 'out-of-area'] as const;
type Step = typeof STEPS[number];
export function hasChosenWelcomeGoal(goal: Awaited<ReturnType<typeof getOnboardingData>>['goal']): boolean {
  return goal === 'lose_fat' || goal === 'build_muscle' || goal === 'performance';
}
export function useOnboardingStep(step?: Step): void {
  useFocusEffect(useCallback(() => { if (step) void AsyncStorage.setItem(KEY, step); }, [step]));
}
export async function getOnboardingResume(): Promise<`/welcome/${Step}` | null> {
  const step = await AsyncStorage.getItem(KEY);
  // Earlier versions asked about prior approaches before collecting location.
  if ((step === 'tried' || step === 'response') && !(await getPreviewSetup()).data.area) return '/welcome/location-permission';
  if (step === 'promise') return '/welcome/location-permission';
  // Older releases collected a target mode before asking for a goal. A
  // saved goal checkpoint from that route needs to return to target setup.
  if (step === 'goal' && !(await AsyncStorage.getItem(GOAL_RETURN_KEY))) {
    const data = await getOnboardingData();
    if (data.targetMode) {
      await rememberGoalReturnTo('/welcome/target-setup');
    }
  }
  if ((step === 'tried' || step === 'response') && !hasChosenWelcomeGoal((await getOnboardingData()).goal)) {
    await rememberGoalReturnTo(`/welcome/${step}`);
    return '/welcome/goal';
  }
  // Earlier onboarding asked about prior approaches before the goal choice.
  // A resumed payoff must collect that choice before showing a goal-specific graph.
  if ((step === 'value-abundance' || step === 'value-payoff' || step === 'goal-payoff') && !hasChosenWelcomeGoal((await getOnboardingData()).goal)) {
    await rememberGoalReturnTo(step === 'goal-payoff' ? '/welcome/goal-payoff' : '/welcome/value-payoff');
    return '/welcome/goal';
  }
  if (step && ['how-it-works', 'target-setup', 'macros-intro', 'height', 'weight', 'age', 'sex', 'activity', 'tuning', 'preview'].includes(step) && !hasChosenWelcomeGoal((await getOnboardingData()).goal)) {
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
  return saved === '/welcome/tried' || saved === '/welcome/response' || saved === '/welcome/value-payoff' || saved === '/welcome/goal-payoff' || saved === '/welcome/target-setup' || saved === '/macro-setup' || saved === '/macro-setup?fromOnboarding=1' ? saved : null;
}

export async function clearGoalReturnTo(): Promise<void> {
  await AsyncStorage.removeItem(GOAL_RETURN_KEY);
}

export async function clearOnboardingResume(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  await AsyncStorage.removeItem(GOAL_RETURN_KEY);
}
