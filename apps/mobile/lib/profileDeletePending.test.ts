/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearToken } from './authClient';
import { queueSavedProfileToServer, replayPendingProfileSync } from './profileSync';
import { getMacroTargets, getQuarantinedLegacyTarget } from './macroStorage';
import { replaceAccountOnboardingData } from './onboardingStorage';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
type Session = { access_token: string; user: { id: string } } | null;
let mockSession: Session = null;
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockSession } }),
    signOut: async () => { mockSession = null; return { error: null }; },
  } }) };
});
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

it('deletion forgets only the deleted account pending body while logout retains retryable work', async () => {
  await AsyncStorage.clear();
  const a = '@fitsy/pending_profile_sync:delete-a';
  const b = '@fitsy/pending_profile_sync:keep-b';
  mockSession = { access_token: 'a-token', user: { id: 'delete-a' } };
  await queueSavedProfileToServer({ weightKg: 73 });
  await AsyncStorage.setItem(b, JSON.stringify({ revision: 1, body: { weightKg: 60 } }));
  await clearToken({ forgetTargets: true });
  expect(await AsyncStorage.getItem(a)).toBeNull();
  expect(await AsyncStorage.getItem(b)).not.toBeNull();
  mockSession = { access_token: 'b-token', user: { id: 'keep-b' } };
  await clearToken();
  expect(await AsyncStorage.getItem(b)).not.toBeNull();
});

it('a delayed write and stale delivery cannot recreate or send a deleted account body', async () => {
  await AsyncStorage.clear();
  const id = 'delete-delayed';
  const key = `@fitsy/pending_profile_sync:${id}`;
  mockSession = { access_token: 'old-token', user: { id } };
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalRead = AsyncStorage.getItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(async name => {
    entered(); await gate; return originalRead(name);
  });
  const oldWrite = queueSavedProfileToServer({ weightKg: 73 });
  await started;
  const deletion = clearToken({ forgetTargets: true });
  // Drain runnable promises so deletion marks the owner before the held read resolves.
  await new Promise(resolve => setTimeout(resolve, 0));
  release();
  await Promise.all([oldWrite, deletion]);
  expect(await AsyncStorage.getItem(key)).toBeNull();
  // An already captured session cannot enqueue or deliver data after deletion.
  mockSession = { access_token: 'old-token', user: { id } };
  global.fetch = jest.fn();
  await queueSavedProfileToServer({ weightKg: 80 });
  await replayPendingProfileSync();
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

it.each([true, false])('deletion purges ambiguous upgrade records while ordinary logout retains them (delete=%s)', async deleting => {
  await AsyncStorage.clear();
  mockSession = { access_token: 'legacy-token', user: { id: `legacy-${deleting}` } };
  await AsyncStorage.setItem('@fitsy/onboarding', JSON.stringify({ weightKg: 140 }));
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify({ protein: '80', carbs: '75', fat: '21', calories: '809', _mode: 'complete' }));
  await AsyncStorage.setItem('@fitsy/macro_targets:other-owner', 'preserved other account');
  await getMacroTargets();
  await replaceAccountOnboardingData(`legacy-${deleting}`, {});
  await clearToken({ forgetTargets: deleting });
  mockSession = { access_token: 'next-token', user: { id: `next-${deleting}` } };
  expect(await AsyncStorage.getItem('@fitsy/onboarding_unowned')).toBe(deleting ? null : JSON.stringify({ weightKg: 140 }));
  expect(Boolean(await getQuarantinedLegacyTarget())).toBe(!deleting);
  expect(await AsyncStorage.getItem('@fitsy/macro_targets:other-owner')).toBe('preserved other account');
});

it('waits for an in-flight quarantine write before purging a deleted account', async () => {
  await AsyncStorage.clear();
  mockSession = { access_token: 'race-token', user: { id: 'legacy-delete-race' } };
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify({ protein: '80', carbs: '75', fat: '21', calories: '809', _mode: 'complete' }));
  const originalSet = AsyncStorage.setItem.bind(AsyncStorage);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    expect(key).toBe('@fitsy/legacy_unowned_macro_targets');
    entered(); await gate;
    return originalSet(key, value);
  });
  const read = getMacroTargets();
  await started;
  const deletion = clearToken({ forgetTargets: true });
  release();
  await Promise.all([read, deletion]);
  expect(await AsyncStorage.getItem('@fitsy/legacy_unowned_macro_targets')).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/macro_targets')).toBeNull();
});
