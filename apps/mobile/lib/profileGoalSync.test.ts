import AsyncStorage from '@react-native-async-storage/async-storage';
import { pullProfileFromServer, pushProfileToServer } from './profileSync';
import { getOnboardingData } from './onboardingStorage';
import { getMacroTargets, saveMacroTargets } from './macroStorage';
import { calculateMacros } from './macroCalculator';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) } }) };
});
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

it('opts into performance goals, restores them and preserves explicit meal targets on sync', async () => {
  await AsyncStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    user: { birthday: null, heightCm: 180, weightKg: 80, sex: 'male', activityLevel: 'active', goal: 'performance' },
    macroTarget: { calories: 2100, proteinG: 105, carbsG: 280, fatG: 70 },
  }) });
  await pullProfileFromServer();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/user/profile?goalSchema=2'), expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-token' } }));
  const profile = await getOnboardingData();
  expect(profile.goal).toBe('performance');
  expect(Object.values(calculateMacros(profile)).every(Number.isFinite)).toBe(true);
  expect(await getMacroTargets()).toEqual({ calories: '600', protein: '30', carbs: '80', fat: '20' });
  const own = { calories: '700', protein: '36', carbs: '74', fat: '26' };
  await saveMacroTargets(own);
  await pushProfileToServer();
  const request = (global.fetch as jest.Mock).mock.calls.at(-1);
  expect(request[0]).toContain('/api/user/profile?goalSchema=2');
  expect(request[1].method).toBe('PATCH');
  expect(JSON.parse(request[1].body)).toEqual(expect.objectContaining({ goal: 'performance', macroTarget: { calories: 2450, proteinG: 126, carbsG: 259, fatG: 91 } }));
  expect(await getMacroTargets()).toEqual(own);
});
