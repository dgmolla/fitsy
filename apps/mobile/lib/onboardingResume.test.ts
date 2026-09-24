import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveMacroTargets } from './macroStorage';
import { saveOnboardingField } from './onboardingStorage';
import { clearOnboardingResume, getOnboardingResume, takeGoalReturnTo } from './onboardingResume';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await AsyncStorage.clear(); });

it.each([
  ['trial', '/welcome/trial'],
  ['trial-reminder', '/welcome/trial-reminder'],
  ['promise', '/welcome/location-permission'],
  ['out-of-area', '/welcome/out-of-area'],
  ['unknown-route', null],
])('resumes the %s checkpoint at %s', async (checkpoint, expected) => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', checkpoint!);
  expect(await getOnboardingResume()).toBe(expected);
});

it.each(['value-abundance', 'value-payoff', 'goal-payoff'])(
  'collects a missing goal before resuming the %s payoff checkpoint', async checkpoint => {
    await AsyncStorage.setItem('@fitsy/onboardingStep', checkpoint);
    await saveOnboardingField('tried', 'check_online');
    expect(await getOnboardingResume()).toBe('/welcome/goal');
    expect(await takeGoalReturnTo()).toBe(checkpoint === 'goal-payoff' ? '/welcome/goal-payoff' : '/welcome/value-payoff');
  },
);

it('keeps the missing-goal payoff destination through a goal checkpoint and clears it on completion', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'value-payoff');
  expect(await getOnboardingResume()).toBe('/welcome/goal');
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'goal');
  expect(await getOnboardingResume()).toBe('/welcome/goal');
  expect(await takeGoalReturnTo()).toBe('/welcome/value-payoff');
  expect(await takeGoalReturnTo()).toBeNull();
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'goal-payoff');
  expect(await getOnboardingResume()).toBe('/welcome/goal');
  await clearOnboardingResume();
  expect(await takeGoalReturnTo()).toBeNull();
});

it.each([
  ['value-abundance', '/welcome/value-payoff'],
  ['value-payoff', '/welcome/value-payoff'],
  ['goal-payoff', '/welcome/goal-payoff'],
])('preserves the %s checkpoint after goal selection', async (checkpoint, expected) => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', checkpoint);
  await saveOnboardingField('goal', 'lose_fat');
  expect(await getOnboardingResume()).toBe(expected);
});

it('repairs an old trust checkpoint that predates meal targets and preserves a completed target setup', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'how-it-works');
  expect(await getOnboardingResume()).toBe('/welcome/goal');
  expect(await takeGoalReturnTo()).toBe('/welcome/target-setup');
  await saveOnboardingField('goal', 'lose_fat');
  expect(await getOnboardingResume()).toBe('/welcome/target-setup');
  await saveMacroTargets({ calories: '600', protein: '45', carbs: '60', fat: '20' });
  expect(await getOnboardingResume()).toBe('/welcome/how-it-works');
});

it.each(['target-setup', 'height', 'weight', 'age', 'sex', 'activity', 'tuning', 'preview'])(
  'collects a missing goal before resuming the %s target checkpoint', async checkpoint => {
    await AsyncStorage.setItem('@fitsy/onboardingStep', checkpoint);
    expect(await getOnboardingResume()).toBe('/welcome/goal');
    expect(await takeGoalReturnTo()).toBe('/welcome/target-setup');
  },
);
