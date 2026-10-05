/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pullProfileFromServer, syncSavedProfileToServer } from './profileSync';
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
  await AsyncStorage.setItem('@fitsy/pending_profile_sync:existing-account', JSON.stringify({
    revision: 1, body: { weightKg: 90, macroTarget: { calories: 2732, proteinG: 298, carbsG: 228, fatG: 70 } },
  }));
  await clearToken();
  expect(await getMacroTargets()).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/macro_targets:existing-account')).not.toBeNull();
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  let serverTarget: unknown = { calories: 2100, proteinG: 100, carbsG: 250, fatG: 78 };
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      expect(body.weightKg).toBe(90);
      serverTarget = body.macroTarget;
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

it('reads a newer server target after signing out an acknowledged edit', async () => {
  await AsyncStorage.clear();
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  const oldTarget = { calories: '560', protein: '35', carbs: '60', fat: '20' };
  let serverTarget = { calories: 1962, proteinG: 123, carbsG: 210, fatG: 70 };
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
  await saveMacroTargets(oldTarget);
  await syncSavedProfileToServer();
  expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:existing-account')).toBeNull();
  await clearToken();
  serverTarget = { calories: 2310, proteinG: 140, carbsG: 280, fatG: 70 };
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  await pullProfileFromServer();
  expect(serverTarget.calories).toBe(2310);
  expect((global.fetch as jest.Mock).mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1);
  expect(await getMacroTargets()).toEqual({ calories: '660', protein: '40', carbs: '80', fat: '20' });
  expect(await AsyncStorage.getItem('@fitsy/macro_targets:existing-account')).toBeNull();
});

it('merges a later target-only write with durable pending body facts', async () => {
  await AsyncStorage.clear();
  mockSession = { access_token: 'account-token', user: { id: 'existing-account' } };
  await AsyncStorage.setItem('@fitsy/pending_profile_sync:existing-account', JSON.stringify({
    revision: 1, body: { weightKg: 90, heightCm: 180, preserveMacroTarget: true },
  }));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  const target = { calories: 2310, proteinG: 140, carbsG: 280, fatG: 70 };
  await syncSavedProfileToServer({ macroTarget: target });
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
    weightKg: 90, heightCm: 180, macroTarget: target,
  });
  expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:existing-account')).toBeNull();
});
