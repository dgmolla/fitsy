import AsyncStorage from '@react-native-async-storage/async-storage';
import { queueSavedProfileToServer, replayPendingProfileSync, syncSavedProfileToServer } from './profileSync';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const nativeRead = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
const nativeRemove = (AsyncStorage.removeItem as jest.Mock).getMockImplementation()!;
beforeEach(() => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation(nativeRead);
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(nativeRemove);
});

jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: {
    access_token: 'synthetic-token', user: { id: 'test-user' },
  } } }) } }) };
});

it('retains a later durable edit while an earlier acknowledgement is deleting its request', async () => {
  // Labeled deterministic external-storage delay; this is not device evidence.
  await AsyncStorage.clear();
  const originalFetch = global.fetch;
  const remove = AsyncStorage.removeItem.bind(AsyncStorage);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const key = '@fitsy/pending_profile_sync:test-user';
  const spy = jest.spyOn(AsyncStorage, 'removeItem').mockImplementationOnce(async name => {
    entered();
    await gate;
    await remove(name);
  });
  const a = { macroTarget: { calories: 2100, proteinG: 140, carbsG: 280, fatG: 70 } };
  const b = { macroTarget: { calories: 2240, proteinG: 175, carbsG: 280, fatG: 70 } };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  try {
    const first = syncSavedProfileToServer(a);
    await started;
    const second = queueSavedProfileToServer(b);
    // One event-loop turn drains runnable storage promises while cleanup is held.
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    await Promise.all([first, second]);
    await replayPendingProfileSync();
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(JSON.parse(calls.at(-1)[1].body).macroTarget).toEqual(b.macroTarget);
    expect(await AsyncStorage.getItem(key)).toBeNull();
  } finally {
    release();
    spy.mockRestore();
    global.fetch = originalFetch;
  }
});


it('delivers the latest revision after a delayed older pending read resolves', async () => {
  // Deterministic external-storage fixture; the real-app/API reproduction is
  // retained separately with its iPhone screenshots and inspector delay receipt.
  await AsyncStorage.clear();
  const originalFetch = global.fetch;
  const read = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const key = '@fitsy/pending_profile_sync:test-user';
  const a = { macroTarget: { calories: 2102, proteinG: 140, carbsG: 228, fatG: 70 } };
  const b = { macroTarget: { calories: 2174, proteinG: 158, carbsG: 228, fatG: 70 } };
  await queueSavedProfileToServer(a);
  let held = false;
  const spy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async name => {
    const raw = await read(name);
    if (name === key && !held) { held = true; entered(); await gate; }
    return raw;
  });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  try {
    const oldRetry = replayPendingProfileSync();
    await started;
    await queueSavedProfileToServer(b);
    const newRetry = replayPendingProfileSync();
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    await Promise.all([oldRetry, newRetry]);
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(JSON.parse(calls.at(-1)[1].body).macroTarget).toEqual(b.macroTarget);
    expect(await read(key)).toBeNull();
  } finally {
    release(); spy.mockRestore(); global.fetch = originalFetch;
  }
});
