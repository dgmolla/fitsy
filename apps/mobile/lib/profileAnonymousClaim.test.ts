/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pullProfileFromServer } from './profileSync';
import { getMacroTargetSource, getMacroTargets, saveMacroTargets } from './macroStorage';
import { clearToken } from './authClient';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockSession: { access_token: string; user: { id: string } } | null = null;
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockSession } }),
    signOut: async () => { mockSession = null; return { error: null }; },
  } }) };
});

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; mockSession = null; });

it('claims an anonymous linked target before pulling an older account target', async () => {
  await AsyncStorage.clear();
  const edited = { calories: '780', protein: '85', carbs: '65', fat: '20' };
  await saveMacroTargets(edited);
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  let serverTarget: { calories: number; proteinG: number; carbsG: number; fatG: number } =
    { calories: 2100, proteinG: 100, carbsG: 250, fatG: 78 };
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body)).toEqual(['macroTarget']);
      serverTarget = body.macroTarget;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: 'maintain' },
      macroTarget: serverTarget,
    }) });
  });
  await pullProfileFromServer();
  expect(serverTarget.proteinG).toBe(298);
  expect((await getMacroTargets())?.protein).toBe('85');
});

it('keeps a saved target private and recoverable after logout before sync', async () => {
  await AsyncStorage.clear();
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  const edited = { calories: '780', protein: '85', carbs: '65', fat: '20' };
  await saveMacroTargets(edited);
  await clearToken();
  expect(await getMacroTargets()).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/macro_targets:existing-account')).not.toBeNull();
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  let serverTarget: unknown = { calories: 2100, proteinG: 100, carbsG: 250, fatG: 78 };
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      serverTarget = JSON.parse(String(init.body)).macroTarget;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: 'maintain' },
      macroTarget: serverTarget,
    }) });
  });
  await pullProfileFromServer();
  expect((serverTarget as { proteinG: number }).proteinG).toBe(298);
  expect((await getMacroTargets())?.protein).toBe('85');
  expect(await AsyncStorage.getItem('@fitsy/macro_targets:existing-account')).toBeNull();
});

it('retains automatic target provenance through logout and profile restore', async () => {
  await AsyncStorage.clear();
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '65', fat: '20' }, 'complete', 'automatic');
  await clearToken();
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  let serverTarget: unknown = null;
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      serverTarget = JSON.parse(String(init.body)).macroTarget;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: 'maintain' },
      macroTarget: serverTarget,
    }) });
  });
  await pullProfileFromServer();
  expect(await getMacroTargetSource()).toBe('automatic');
});
