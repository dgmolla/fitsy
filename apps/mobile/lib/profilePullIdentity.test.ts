/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pullProfileFromServer } from './profileSync';
import { getMacroTargets, saveMacroTargets } from './macroStorage';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockSession = { access_token: 'account-a-token', user: { id: 'account-a' } };
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: mockSession } }) } }) };
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  mockSession = { access_token: 'account-a-token', user: { id: 'account-a' } };
});

it('discards a profile response when its account leaves before the GET resolves', async () => {
  await AsyncStorage.clear();
  let finishGet: ((response: unknown) => void) | undefined;
  global.fetch = jest.fn(() => new Promise(resolve => { finishGet = resolve; })) as jest.Mock;
  const oldPull = pullProfileFromServer();
  while ((global.fetch as jest.Mock).mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  mockSession = { access_token: 'account-b-token', user: { id: 'account-b' } };
  const bTarget = { calories: '500', protein: '25', carbs: '55', fat: '20' };
  await saveMacroTargets(bTarget);
  finishGet?.({ ok: true, status: 200, json: async () => ({
    user: { birthday: null, heightCm: null, weightKg: 90, sex: null, activityLevel: null, goal: 'build_muscle' },
    macroTarget: { calories: 2100, proteinG: 175, carbsG: 250, fatG: 45 },
  }) });
  await oldPull;
  expect(await getMacroTargets()).toEqual(bTarget);
  expect(await AsyncStorage.getItem('@fitsy/onboarding')).toBeNull();
});

it('does not sign out a new account for an old profile GET returning 401', async () => {
  await AsyncStorage.clear();
  let finishGet: ((response: unknown) => void) | undefined;
  global.fetch = jest.fn(() => new Promise(resolve => { finishGet = resolve; })) as jest.Mock;
  const oldPull = pullProfileFromServer();
  while ((global.fetch as jest.Mock).mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  mockSession = { access_token: 'account-b-token', user: { id: 'account-b' } };
  finishGet?.({ ok: false, status: 401, json: async () => ({ error: 'expired' }) });
  await oldPull;
  expect(mockSession.user.id).toBe('account-b');
});

it('does not restore a delayed GET over a newer saved profile edit', async () => {
  await AsyncStorage.clear();
  let finishGet: ((response: unknown) => void) | undefined;
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    return new Promise(resolve => { finishGet = resolve; });
  }) as jest.Mock;
  const oldPull = pullProfileFromServer();
  while ((global.fetch as jest.Mock).mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  const edited = { calories: '660', protein: '40', carbs: '80', fat: '20' };
  await saveMacroTargets(edited);
  const { syncSavedProfileToServer } = await import('./profileSync');
  await syncSavedProfileToServer({ weightKg: 90, macroTarget: { calories: 2310, proteinG: 140, carbsG: 280, fatG: 70 } });
  finishGet?.({ ok: true, status: 200, json: async () => ({
    user: { birthday: null, heightCm: null, weightKg: 70, sex: null, activityLevel: null, goal: 'maintain' },
    macroTarget: { calories: 1890, proteinG: 105, carbsG: 210, fatG: 70 },
  }) });
  await oldPull;
  expect(await getMacroTargets()).toEqual(edited);
  expect(await AsyncStorage.getItem('@fitsy/onboarding')).toBeNull();
});
