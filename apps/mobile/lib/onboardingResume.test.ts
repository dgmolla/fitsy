import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveMacroTargets } from './macroStorage';
import { getOnboardingResume } from './onboardingResume';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await AsyncStorage.clear(); });

it.each([
  ['trial', '/welcome/trial'],
  ['trial-reminder', '/welcome/trial-reminder'],
  ['goal-payoff', '/welcome/goal-payoff'],
  ['promise', '/welcome/location-permission'],
  ['value-abundance', '/welcome/value-payoff'],
  ['value-payoff', '/welcome/value-payoff'],
  ['out-of-area', '/welcome/out-of-area'],
  ['tuning', '/welcome/tuning'],
  ['unknown-route', null],
])('resumes the %s checkpoint at %s', async (checkpoint, expected) => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', checkpoint!);
  expect(await getOnboardingResume()).toBe(expected);
});

it('repairs an old trust checkpoint that predates meal targets and preserves a completed target setup', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'how-it-works');
  expect(await getOnboardingResume()).toBe('/welcome/target-setup');
  await saveMacroTargets({ calories: '600', protein: '45', carbs: '60', fat: '20' });
  expect(await getOnboardingResume()).toBe('/welcome/how-it-works');
});
