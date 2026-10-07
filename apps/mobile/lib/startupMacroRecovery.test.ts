/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { recoverStartupMealTargets } from './startupMacroRecovery';
import { getDiscoveryMacroTargetSnapshot, getMacroTargets, getQuarantinedLegacyTarget,
  restoreQuarantinedLegacyTarget, saveMacroTargets } from './macroStorage';
import { replayPendingProfileSync, requireProfileFromServer } from './profileSync';
import { onboardingEntry } from './onboardingEntry';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockSession: { access_token: string; user: { id: string } } | null = null;
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockSession } }),
  } }) };
});
const originalFetch = global.fetch;
const legacy = { calories: '600', protein: '50', carbs: '65', fat: '20' };
const user = { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: null };
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
beforeEach(async () => {
  await AsyncStorage.clear();
  mockSession = { access_token: 'buyer-token', user: { id: 'buyer' } };
  global.fetch = jest.fn().mockResolvedValue(response({ user, macroTarget: null }));
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify(legacy));
});
afterEach(() => { global.fetch = originalFetch; mockSession = null; });

it('restores an upgraded independent filter before the existing startup routing decision', async () => {
  const confirm = jest.fn().mockResolvedValue(true);
  const recovery = await recoverStartupMealTargets(confirm);
  const hasTargets = recovery === 'restored';
  expect(confirm).toHaveBeenCalledWith('search');
  expect(hasTargets).toBe(true);
  expect(await getMacroTargets()).toBeNull();
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(legacy);
  expect(await getQuarantinedLegacyTarget()).toBeNull();
  expect(onboardingEntry({ signedIn: true, purchasesReady: true, entitled: true,
    isLapsed: false, completed: true, declined: false, resume: null, hasTargets,
    access: 'hard', onboardingPreviewEntry: false })).toBe('/(tabs)/search');
  expect(global.fetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'PATCH' }));
});

it('hydrates the current server allocation without offering ownerless device data', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ user,
    macroTarget: { calories: 2590, proteinG: 210, carbsG: 280, fatG: 70, source: 'manual' } }));
  const confirm = jest.fn();
  expect(await recoverStartupMealTargets(confirm)).toBe('restored');
  expect(confirm).not.toHaveBeenCalled();
  expect(await getMacroTargets()).toEqual({ calories: '740', protein: '60', carbs: '80', fat: '20' });
  expect((await getQuarantinedLegacyTarget())?.targets).toEqual(legacy);
});

it('retains a declined legacy filter for later explicit recovery', async () => {
  expect(await recoverStartupMealTargets(async () => false)).toBe('absent');
  expect(await getDiscoveryMacroTargetSnapshot()).toBeNull();
  expect((await getQuarantinedLegacyTarget())?.targets).toEqual(legacy);
});

it('does not transfer the confirmed filter when the account changes during the choice', async () => {
  expect(await recoverStartupMealTargets(async () => {
    mockSession = { access_token: 'other-token', user: { id: 'other' } };
    return true;
  })).toBe('account-changed');
  expect(await getDiscoveryMacroTargetSnapshot()).toBeNull();
  expect((await getQuarantinedLegacyTarget())?.targets).toEqual(legacy);
  expect(await restoreQuarantinedLegacyTarget('buyer')).toBeNull();
});

it('restores complete legacy grams with their settled energy and queues the daily API target', async () => {
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify({ calories: '640', protein: '50', carbs: '65', fat: '20' }));
  const confirm = jest.fn().mockResolvedValue(true);
  expect(await recoverStartupMealTargets(confirm)).toBe('restored');
  expect(confirm).toHaveBeenCalledWith('complete');
  expect(await getMacroTargets()).toEqual({ calories: '640', protein: '50', carbs: '65', fat: '20' });
  await replayPendingProfileSync();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/user/profile'),
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ macroTarget: {
      proteinG: 175, carbsG: 228, fatG: 70, source: 'manual', calories: 2242,
    } }) }));
});

it('does not refetch or prompt for a current account target', async () => {
  await saveMacroTargets({ calories: '780', protein: '85', carbs: '65', fat: '20' });
  const confirm = jest.fn();
  expect(await recoverStartupMealTargets(confirm)).toBe('restored');
  expect(confirm).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('claims an intentional anonymous edit before accepting it as a signed-in target', async () => {
  const manual = { calories: '640', protein: '50', carbs: '65', fat: '20' };
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify({ ...manual,
    _mode: 'complete', _owner: null, _source: 'manual' }));
  expect(await getMacroTargets()).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/macro_targets')).not.toBeNull();
  global.fetch = jest.fn().mockResolvedValue(response({ user, macroTarget: {
    calories: 2242, proteinG: 175, carbsG: 228, fatG: 70, source: 'manual',
  } }));
  const confirm = jest.fn();
  expect(await recoverStartupMealTargets(confirm)).toBe('restored');
  expect(confirm).not.toHaveBeenCalled();
  expect(await getMacroTargets()).toEqual(manual);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/user/profile'),
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ macroTarget: {
      proteinG: 175, carbsG: 228, fatG: 70, source: 'manual', calories: 2242,
    } }) }));
  expect(JSON.parse((await AsyncStorage.getItem('@fitsy/macro_targets'))!)._owner).toBe('buyer');
});

it('distinguishes an unavailable profile from confirmed absence without prompting or replacing data', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  const confirm = jest.fn();
  expect(await recoverStartupMealTargets(confirm)).toBe('unavailable');
  expect(confirm).not.toHaveBeenCalled();
  expect(await getMacroTargets()).toBeNull();
  expect((await getQuarantinedLegacyTarget())?.targets).toEqual(legacy);
  global.fetch = jest.fn().mockResolvedValue(response({ user, macroTarget: {
    calories: 2590, proteinG: 210, carbsG: 280, fatG: 70, source: 'manual',
  } }));
  expect(await recoverStartupMealTargets(confirm)).toBe('restored');
  expect(await getMacroTargets()).toEqual({ calories: '740', protein: '60', carbs: '80', fat: '20' });
  expect(confirm).not.toHaveBeenCalled();
});

it('prevents sign-in completion from treating a failed profile pull as a settled account', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(requireProfileFromServer()).rejects.toThrow('Could not load your account targets');
  expect(await getMacroTargets()).toBeNull();
});


it('hydrates the account complete target while preserving its intentional partial filter', async () => {
  await AsyncStorage.removeItem('@fitsy/macro_targets');
  const filter = { protein: '65', carbs: '', fat: '', calories: '' };
  await saveMacroTargets(filter, 'search');
  global.fetch = jest.fn().mockResolvedValue(response({ user,
    macroTarget: { calories: 2590, proteinG: 210, carbsG: 280, fatG: 70, source: 'manual' } }));
  const confirm = jest.fn();
  expect(await recoverStartupMealTargets(confirm)).toBe('restored');
  expect(await getMacroTargets()).toEqual({ calories: '740', protein: '60', carbs: '80', fat: '20' });
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(filter);
  expect(confirm).not.toHaveBeenCalled();
});
