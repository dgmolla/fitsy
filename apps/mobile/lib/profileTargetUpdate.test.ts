/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncSavedProfileToServer } from './profileSync';
import { saveOnboardingField } from './onboardingStorage';
import { archiveActiveMacroTargets, getMacroTargetSource, getMacroTargets, saveMacroTargets } from './macroStorage';
import { calculateMacros, macrosToStored } from './macroCalculator';
import { updateProfileFieldAndTargets } from './profileTargetUpdate';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: {
    access_token: 'synthetic-token', user: { id: 'test-user' },
  } } }) } }) };
});

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

it('keeps a manual high-protein target through profile edits and API sync', async () => {
  await AsyncStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await saveOnboardingField('goal', 'maintain');
  const manual = { calories: '780', protein: '85', carbs: '65', fat: '20' };
  await saveMacroTargets(manual);
  const updated = await updateProfileFieldAndTargets('weightKg', 90);
  expect(updated.targets).toEqual(manual);
  expect(await getMacroTargets()).toEqual(manual);
  expect(await getMacroTargetSource()).toBe('manual');
  await syncSavedProfileToServer();
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)[1].body).macroTarget.proteinG).toBe(298);
  const automatic = { calories: '600', protein: '40', carbs: '65', fat: '20' };
  await saveMacroTargets(automatic, 'complete', 'automatic');
  const recalculated = await updateProfileFieldAndTargets('weightKg', 95);
  expect(recalculated.targets).toEqual(await getMacroTargets());
  expect(await getMacroTargetSource()).toBe('automatic');
});

it('retunes an archived automatic target after a profile edit before hydration', async () => {
  await AsyncStorage.clear();
  await saveOnboardingField('goal', 'build_muscle');
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '65', fat: '20' }, 'complete', 'automatic');
  await archiveActiveMacroTargets('test-user');
  const updated = await updateProfileFieldAndTargets('weightKg', 90);
  expect(updated.targets).toEqual(macrosToStored(calculateMacros(updated.profile)));
  expect(updated.targets?.calories).not.toBe('600');
  expect(await getMacroTargetSource()).toBe('automatic');
});
