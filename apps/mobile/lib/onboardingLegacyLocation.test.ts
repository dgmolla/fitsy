import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOnboardingResume } from './onboardingResume';
import { getOnboardingData, saveOnboardingField } from './onboardingStorage';
import { getPreviewSetup } from './previewSetup';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await AsyncStorage.clear(); });

it.each(['tried', 'response'])('repairs a legacy %s checkpoint before replaying screens that now follow location', async (step) => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', step);
  await saveOnboardingField('tried', 'meal_prep');
  expect((await getPreviewSetup()).data.area).toBeUndefined();
  expect(await getOnboardingResume()).toBe('/welcome/location-permission');
  expect((await getOnboardingData()).tried).toBe('meal_prep');
});

it('retains a response checkpoint when its chosen area already exists', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'response');
  await saveOnboardingField('area', { lat: 34.08, lng: -118.27, name: 'Silver Lake', source: 'manual' });
  expect(await getOnboardingResume()).toBe('/welcome/response');
});
