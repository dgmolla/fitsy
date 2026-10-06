/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pullProfileFromServer, syncSavedProfileToServer } from './profileSync';
import { saveOnboardingField, getOnboardingData } from './onboardingStorage';
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

it.each([
  ['weightKg', undefined], ['weightKg', 0], ['weightKg', 22.9], ['weightKg', 320.1], ['weightKg', NaN],
  ['heightCm', undefined], ['heightCm', 121], ['heightCm', 230], ['birthday', undefined], ['birthday', 'invalid'],
] as const)('rejects invalid %s without changing facts, targets or pending API body', async (field, value) => {
  await AsyncStorage.clear();
  await saveOnboardingField('weightKg', 90);
  await saveOnboardingField('heightCm', 180);
  const target = { calories: '600', protein: '40', carbs: '65', fat: '20' };
  await saveMacroTargets(target, 'complete', 'automatic');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await expect(updateProfileFieldAndTargets(field, value)).rejects.toThrow('Enter');
  expect(await getOnboardingData()).toEqual({ weightKg: 90, heightCm: 180 });
  expect(await getMacroTargets()).toEqual(target);
  expect(global.fetch).not.toHaveBeenCalled();
});

it.each(['automatic', 'manual'] as const)('restores %s provenance on a fresh device before a goal edit', async source => {
  await AsyncStorage.clear();
  const profile = { birthday: '1995-01-01', heightCm: 180, weightKg: 90,
    sex: 'male' as const, activity: 'active' as const, goal: 'build_muscle' as const };
  global.fetch = jest.fn().mockImplementation((_url, init) => Promise.resolve({
    ok: true, status: 200, json: async () => init?.method === 'PATCH' ? {} : {
      user: { ...profile, activityLevel: profile.activity },
      macroTarget: { calories: 3207, proteinG: 120, carbsG: 441, fatG: 107, source },
    },
  }));
  await pullProfileFromServer();
  expect(await getMacroTargetSource()).toBe(source);
  const restored = await getMacroTargets();
  const updated = await updateProfileFieldAndTargets('goal', 'lose_fat');
  expect(updated.targets).toEqual(source === 'automatic'
    ? macrosToStored(calculateMacros({ ...profile, goal: 'lose_fat' })) : restored);
  if (source === 'automatic') expect(updated.targets).not.toEqual(restored);
  await syncSavedProfileToServer();
  const body = JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)[1].body);
  expect(body.macroTarget.source).toBe(source);
  expect(body.macroTarget.calories).toBe(4 * body.macroTarget.proteinG
    + 4 * body.macroTarget.carbsG + 9 * body.macroTarget.fatG);
  // A reinstall discards local tags; server provenance alone must restore them.
  await AsyncStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    user: { ...profile, goal: 'lose_fat', activityLevel: profile.activity }, macroTarget: body.macroTarget,
  }) });
  await pullProfileFromServer();
  expect(await getMacroTargetSource()).toBe(source);
  expect(await getMacroTargets()).toEqual(updated.targets);
});

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
