/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearToken } from './authClient';
import { claimAnonymousOnboardingData, getOnboardingData, replaceAccountOnboardingData,
  saveOnboardingField, getLegacyOnboardingData, restoreLegacyOnboardingData, retireLegacyOnboardingData } from './onboardingStorage';
import { buildProfileBody } from './profileTargetBody';
import { pullProfileFromServer } from './profileSync';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
type Session = { access_token: string; user: { id: string } } | null;
let mockSession: Session = { access_token: 'a-token', user: { id: 'a' } };
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockSession } }),
    signOut: async () => { mockSession = null; return { error: null }; },
  } }) };
});
const originalFetch = global.fetch;
const emptyUser = { birthday: null, heightCm: null, weightKg: null, sex: null,
  activityLevel: null, goal: null };
beforeEach(async () => {
  mockSession = { access_token: 'a-token', user: { id: 'a' } };
  await AsyncStorage.clear();
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
const useB = () => { mockSession = { access_token: 'b-token', user: { id: 'b' } }; };

it('never displays or sends A measurements after B reconciles an empty profile', async () => {
  await saveOnboardingField('weightKg', 140);
  await saveOnboardingField('goal', 'build_muscle');
  useB();
  expect(await getOnboardingData()).toEqual({});
  expect(await buildProfileBody()).toEqual({});
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ user: emptyUser, macroTarget: null }) });
  expect(await pullProfileFromServer()).toBe('absent');
  expect(await getOnboardingData()).toEqual({});
  expect(await buildProfileBody()).toEqual({});
  expect((global.fetch as jest.Mock).mock.calls.every(call => !call[1]?.method)).toBe(true);
});

it('does not claim legacy unowned measurements into an authenticated account', async () => {
  await AsyncStorage.setItem('@fitsy/onboarding', JSON.stringify({ weightKg: 140, goal: 'build_muscle' }));
  expect(await claimAnonymousOnboardingData('a')).toBe(false);
  expect(await getOnboardingData()).toEqual({});
  expect(await buildProfileBody()).toEqual({});
});

it('does not relabel legacy measurements when a logged-out user edits only their goal', async () => {
  mockSession = null;
  await AsyncStorage.setItem('@fitsy/onboarding', JSON.stringify({ weightKg: 140, heightCm: 200, goal: 'build_muscle' }));
  expect(await getOnboardingData()).toEqual({});
  await saveOnboardingField('goal', 'performance');
  expect(await getOnboardingData()).toEqual({ goal: 'performance' });
  useB();
  let user = emptyUser as Record<string, unknown>;
  global.fetch = jest.fn().mockImplementation((_url, init?: RequestInit) => {
    if (init?.method === 'PATCH') user = { ...user, ...JSON.parse(String(init.body)) };
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ user, macroTarget: null }) });
  });
  await pullProfileFromServer();
  expect(await getOnboardingData()).toEqual({ goal: 'performance' });
  expect(user.weightKg).toBeNull();
  expect(user.heightCm).toBeNull();
  expect(await getLegacyOnboardingData()).toMatchObject({ weightKg: 140, heightCm: 200 });
  // Only explicit account restoration recovers these retained intentional edits.
  expect(await restoreLegacyOnboardingData()).toMatchObject({ owner: 'b', profile: { weightKg: 140, heightCm: 200, goal: 'build_muscle' } });
  await retireLegacyOnboardingData('b');
  expect(await getLegacyOnboardingData()).toBeNull();
});

it('retains legacy facts through an empty profile reconciliation and rejects anonymous restoration', async () => {
  await AsyncStorage.setItem('@fitsy/onboarding', JSON.stringify({ weightKg: 140 }));
  await replaceAccountOnboardingData('a', {});
  expect(await getOnboardingData()).toEqual({});
  expect(await getLegacyOnboardingData()).toMatchObject({ weightKg: 140 });
  mockSession = null;
  await expect(restoreLegacyOnboardingData()).rejects.toThrow('Sign in');
  expect(await getLegacyOnboardingData()).toMatchObject({ weightKg: 140 });
});

it('claims explicitly saved anonymous onboarding facts and sends them through real profile synchronization', async () => {
  mockSession = null;
  await saveOnboardingField('weightKg', 75);
  await saveOnboardingField('goal', 'performance');
  useB();
  let user = emptyUser as Record<string, unknown>;
  global.fetch = jest.fn().mockImplementation((_url, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      user = { ...user, ...body };
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ user, macroTarget: null }) });
  });
  await pullProfileFromServer();
  expect(await getOnboardingData()).toEqual({ weightKg: 75, goal: 'performance' });
  const patch = (global.fetch as jest.Mock).mock.calls.find(call => call[1]?.method === 'PATCH');
  expect(JSON.parse(patch[1].body)).toEqual({ weightKg: 75, goal: 'performance' });
  expect(await claimAnonymousOnboardingData('b')).toBe(false);
});

it('clears null server measurements while retaining the same account setup metadata', async () => {
  await saveOnboardingField('weightKg', 140);
  await saveOnboardingField('goal', 'build_muscle');
  await saveOnboardingField('targetMode', 'known');
  expect(await replaceAccountOnboardingData('a', {})).toBe(true);
  expect(await getOnboardingData()).toEqual({ targetMode: 'known' });
  useB();
  expect(await replaceAccountOnboardingData('b', {})).toBe(true);
  expect(await getOnboardingData()).toEqual({});
});

it('rejects a delayed A save after B takes over, then preserves B edits', async () => {
  let release: (() => void) | undefined;
  const originalRead = AsyncStorage.getItem.bind(AsyncStorage);
  const entered = new Promise<void>(resolve => {
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(async key => {
      resolve();
      await new Promise<void>(done => { release = done; });
      return originalRead(key);
    });
  });
  const oldSave = saveOnboardingField('weightKg', 140);
  await entered;
  useB();
  const bSave = saveOnboardingField('weightKg', 70);
  release?.();
  await expect(oldSave).rejects.toThrow('Account changed');
  await bSave;
  expect(await getOnboardingData()).toEqual({ weightKg: 70 });
  expect(await buildProfileBody()).toEqual({ weightKg: 70 });
});

it('discards a delayed A reconciliation instead of overwriting B onboarding', async () => {
  useB();
  await saveOnboardingField('weightKg', 70);
  expect(await replaceAccountOnboardingData('a', { weightKg: 140 })).toBe(false);
  expect(await getOnboardingData()).toEqual({ weightKg: 70 });
});

it.each([true, false])('logout retires owned and legacy body facts (legacy=%s)', async legacy => {
  if (legacy) await AsyncStorage.setItem('@fitsy/onboarding', JSON.stringify({ weightKg: 140 }));
  else await saveOnboardingField('weightKg', 140);
  await clearToken();
  expect(await getOnboardingData()).toEqual({});
  expect(await AsyncStorage.getItem('@fitsy/onboarding')).toBeNull();
  useB();
  expect(await claimAnonymousOnboardingData('b')).toBe(false);
});
