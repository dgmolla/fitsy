import { acknowledgePendingMacroTarget, getPendingMacroTarget } from './macroTargetSync';
/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMacroTargets, saveMacroTargets } from './macroStorage';
import { pullProfileFromServer, replayPendingProfileSync, queueSavedProfileToServer, syncSavedProfileToServer } from './profileSync';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: {
    access_token: 'synthetic-token', user: { id: 'test-user' },
  } } }) } }) };
});

const originalFetch = global.fetch;
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

it('keeps retrying a pending target after the initial outage window', async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  await saveMacroTargets({ calories: '640', protein: '50', carbs: '65', fat: '20' });
  global.fetch = jest.fn().mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await syncSavedProfileToServer();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  for (const delay of [1000, 5000, 15000, 60000]) await jest.advanceTimersByTimeAsync(delay);
  expect(global.fetch).toHaveBeenCalledTimes(5);
  expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).toBeNull();
});


it('replays the target record after interruption before any separate API queue write', async () => {
  await AsyncStorage.clear();
  const edited = { calories: '849', protein: '90', carbs: '75', fat: '21' };
  await saveMacroTargets(edited);
  expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).toBeNull();
  let target = { proteinG: 298, carbsG: 263, fatG: 74, calories: 2910, source: 'manual' };
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') target = JSON.parse(String(init.body)).macroTarget;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: null },
      macroTarget: target,
    }) });
  });
  await replayPendingProfileSync();
  expect(target).toEqual({ proteinG: 315, carbsG: 263, fatG: 74, calories: 2978, source: 'manual' });
  expect(await getPendingMacroTarget('test-user')).toBeNull();
  expect(await pullProfileFromServer()).toBe('restored');
  expect(await getMacroTargets()).toEqual(edited);
});

it('keeps a newer target intent when an older target acknowledgement finishes', async () => {
  await AsyncStorage.clear();
  await saveMacroTargets({ calories: '829', protein: '85', carbs: '75', fat: '21' });
  const old = (await getPendingMacroTarget('test-user'))!;
  await saveMacroTargets({ calories: '849', protein: '90', carbs: '75', fat: '21' });
  await acknowledgePendingMacroTarget(old);
  expect((await getPendingMacroTarget('test-user'))?.targets.protein).toBe('90');
});

it('does not replay an old dirty archive over an acknowledged active allocation', async () => {
  await AsyncStorage.clear();
  await saveMacroTargets({ calories: '829', protein: '85', carbs: '75', fat: '21' });
  const old = await AsyncStorage.getItem('@fitsy/macro_targets');
  await AsyncStorage.setItem('@fitsy/macro_targets:test-user', old!);
  await saveMacroTargets({ calories: '849', protein: '90', carbs: '75', fat: '21' });
  await acknowledgePendingMacroTarget((await getPendingMacroTarget('test-user'))!);
  expect(await getPendingMacroTarget('test-user')).toBeNull();
});


it('recovers interrupted acknowledgement cleanup without overwriting a newer remote target', async () => {
  await AsyncStorage.clear();
  await saveMacroTargets({ calories: '829', protein: '85', carbs: '75', fat: '21' });
  await queueSavedProfileToServer();
  const key = '@fitsy/pending_profile_sync:test-user';
  const pending = (await AsyncStorage.getItem(key))!;
  let target = { proteinG: 298, carbsG: 263, fatG: 74, calories: 2910, source: 'manual' };
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') target = JSON.parse(String(init.body)).macroTarget;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: null },
      macroTarget: target,
    }) });
  });
  await replayPendingProfileSync();
  // External storage state represents a crash after durable acknowledgement,
  // before cleanup; the real delivery and acknowledgement already completed.
  await AsyncStorage.setItem(key, pending);
  target = { proteinG: 315, carbsG: 263, fatG: 74, calories: 2978, source: 'manual' };
  jest.mocked(global.fetch).mockClear();
  await replayPendingProfileSync();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(await pullProfileFromServer()).toBe('restored');
  expect((await getMacroTargets())?.protein).toBe('90');
  // An intentional later edit with the old grams is a distinct operation.
  await saveMacroTargets({ calories: '829', protein: '85', carbs: '75', fat: '21' });
  await replayPendingProfileSync();
  expect(target.proteinG).toBe(298);
});
