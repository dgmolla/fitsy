/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveMacroTargets } from './macroStorage';
import { syncSavedProfileToServer } from './profileSync';

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
