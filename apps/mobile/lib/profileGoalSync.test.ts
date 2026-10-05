import AsyncStorage from '@react-native-async-storage/async-storage';
import { pullProfileFromServer, pushProfileToServer, replayPendingProfileSync, syncSavedProfileToServer } from './profileSync';
import { getOnboardingData, saveOnboardingField } from './onboardingStorage';
import { getDiscoveryMacroTargetSnapshot, getMacroTargets, getQuarantinedLegacyTarget,
  saveDiscoveryMacroTargets, saveMacroTargets } from './macroStorage';
import { calculateMacros } from './macroCalculator';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockCurrentSession = { access_token: 'synthetic-token', user: { id: 'test-user' } };
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: mockCurrentSession } }) } }) };
});
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  mockCurrentSession = { access_token: 'synthetic-token', user: { id: 'test-user' } };
});

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
  expect(await getMacroTargets()).toEqual({ calories: '620', protein: '30', carbs: '80', fat: '20' });
  const own = { calories: '700', protein: '36', carbs: '74', fat: '26' };
  await saveMacroTargets(own);
  await pushProfileToServer();
  const request = (global.fetch as jest.Mock).mock.calls.at(-1);
  expect(request[0]).toContain('/api/user/profile?goalSchema=2');
  expect(request[1].method).toBe('PATCH');
  expect(JSON.parse(request[1].body)).toEqual(expect.objectContaining({ goal: 'performance', macroTarget: { calories: 2359, proteinG: 126, carbsG: 259, fatG: 91, source: 'manual' } }));
  expect(await getMacroTargets()).toEqual({ ...own, calories: '674' });
});

it('keeps an independent discovery filter out of complete profile synchronization', async () => {
  await AsyncStorage.clear();
  await saveOnboardingField('goal', 'maintain');
  const partial = { calories: '600', protein: '0', carbs: '65', fat: '20' };
  await saveMacroTargets(partial, 'search');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: 'maintain' },
    macroTarget: { calories: 2100, proteinG: 100, carbsG: 250, fatG: 78 },
  }) });
  await pushProfileToServer();
  const pushed = (global.fetch as jest.Mock).mock.calls.at(-1);
  expect(pushed[0]).toContain('/api/user/profile?goalSchema=2');
  expect(JSON.parse(pushed[1].body)).toEqual(expect.objectContaining({ preserveMacroTarget: true }));
  expect(JSON.parse(pushed[1].body)).not.toHaveProperty('macroTarget');
  await pullProfileFromServer();
  expect(await getMacroTargets()).toEqual({ calories: '598', protein: '29', carbs: '71', fat: '22' });
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(partial);
  const allPositive = { calories: '600', protein: '40', carbs: '60', fat: '20' };
  await saveMacroTargets(allPositive, 'search');
  await pushProfileToServer();
  const secondPush = (global.fetch as jest.Mock).mock.calls.at(-1);
  expect(JSON.parse(secondPush[1].body)).toHaveProperty('macroTarget');
  await pullProfileFromServer();
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(allPositive);
});

it('shows each account its own independent filter after a profile pull', async () => {
  await AsyncStorage.clear();
  const accountAFilter = { calories: '600', protein: '45', carbs: '', fat: '20' };
  await saveMacroTargets(accountAFilter, 'search');
  mockCurrentSession = { access_token: 'other-token', user: { id: 'other-user' } };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: 'maintain' },
    macroTarget: { calories: 2100, proteinG: 100, carbsG: 250, fatG: 78 },
  }) });
  await pullProfileFromServer();
  expect((await getDiscoveryMacroTargetSnapshot())?.mode).toBe('complete');
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).not.toEqual(accountAFilter);
  mockCurrentSession = { access_token: 'synthetic-token', user: { id: 'test-user' } };
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(accountAFilter);
});

it('syncs a linked discovery target to the profile API and restores it on a new device', async () => {
  await AsyncStorage.clear();
  await saveOnboardingField('goal', 'build_muscle');
  let serverTarget: { calories: number; proteinG: number; carbsG: number; fatG: number } | null = null;
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      serverTarget = JSON.parse(String(init.body)).macroTarget;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: 'build_muscle' },
      macroTarget: serverTarget,
    }) });
  });
  const linked = { calories: '600', protein: '40', carbs: '65', fat: '20' };
  await saveMacroTargets({ calories: '620', protein: '45', carbs: '65', fat: '20' }, 'search');
  await saveDiscoveryMacroTargets(linked, 'complete');
  await syncSavedProfileToServer();
  expect(serverTarget).toEqual({ calories: 2102, proteinG: 140, carbsG: 228, fatG: 70, source: 'manual' });
  await AsyncStorage.clear();
  await pullProfileFromServer();
  const restored = await getMacroTargets();
  expect(restored?.calories).toBe(String(4 * Number(restored?.protein)
    + 4 * Number(restored?.carbs) + 9 * Number(restored?.fat)));
  expect(Number(restored?.protein)).toBe(40);
});

it('serializes rapid profile pushes so the latest linked target wins', async () => {
  await AsyncStorage.clear();
  let finishFirst: ((value: unknown) => void) | undefined;
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await saveDiscoveryMacroTargets({ calories: '600', protein: '40', carbs: '65', fat: '20' }, 'complete');
  const first = pushProfileToServer();
  while ((global.fetch as jest.Mock).mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  await saveDiscoveryMacroTargets({ calories: '640', protein: '50', carbs: '65', fat: '20' }, 'complete');
  const second = pushProfileToServer();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  finishFirst?.({ ok: true, status: 200, json: async () => ({}) });
  expect(await Promise.all([first, second])).toEqual([true, true]);
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(JSON.parse(calls[0][1].body).macroTarget.proteinG).toBe(140);
  expect(JSON.parse(calls[1][1].body).macroTarget.proteinG).toBe(175);
});

it('serializes rapid saved edits through their durable queue and API writes', async () => {
  await AsyncStorage.clear();
  let finishFirst: ((value: unknown) => void) | undefined;
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '65', fat: '20' });
  const first = syncSavedProfileToServer();
  while ((global.fetch as jest.Mock).mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  await saveMacroTargets({ calories: '640', protein: '50', carbs: '65', fat: '20' });
  const second = syncSavedProfileToServer();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  finishFirst?.({ ok: true, status: 200, json: async () => ({}) });
  await Promise.all([first, second]);
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(JSON.parse(calls[0][1].body).macroTarget.proteinG).toBe(140);
  expect(JSON.parse(calls[1][1].body).macroTarget.proteinG).toBe(175);
  expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).toBeNull();
});

it('does not queue a different account body under a captured prior account', async () => {
  await AsyncStorage.clear();
  let finishFirst: ((value: unknown) => void) | undefined;
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '65', fat: '20' });
  const first = syncSavedProfileToServer();
  while ((global.fetch as jest.Mock).mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  const queued = syncSavedProfileToServer();
  mockCurrentSession = { access_token: 'other-token', user: { id: 'other-user' } };
  await saveMacroTargets({ calories: '780', protein: '85', carbs: '65', fat: '20' });
  finishFirst?.({ ok: true, status: 200, json: async () => ({}) });
  await Promise.all([first, queued]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).toBeNull();
  mockCurrentSession = { access_token: 'synthetic-token', user: { id: 'test-user' } };
  await replayPendingProfileSync();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('does not send a queued old-account edit under a newly signed-in account', async () => {
  await AsyncStorage.clear();
  let finishFirst: ((value: unknown) => void) | undefined;
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '65', fat: '20' });
  const first = pushProfileToServer();
  while ((global.fetch as jest.Mock).mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  const queued = pushProfileToServer();
  mockCurrentSession = { access_token: 'other-token', user: { id: 'other-user' } };
  finishFirst?.({ ok: true, status: 200, json: async () => ({}) });
  expect(await first).toBe(true);
  expect(await queued).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('retries a failed linked-target PATCH using the saved pending target', async () => {
  jest.useFakeTimers();
  try {
    await AsyncStorage.clear();
    await saveDiscoveryMacroTargets({ calories: '640', protein: '50', carbs: '65', fat: '20' }, 'complete');
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await syncSavedProfileToServer();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).macroTarget.proteinG).toBe(175);
  } finally {
    jest.useRealTimers();
  }
});

it('replays a failed profile edit before pulling the server target', async () => {
  jest.useFakeTimers();
  try {
    await AsyncStorage.clear();
    const edited = { calories: '640', protein: '50', carbs: '65', fat: '20' };
    await saveMacroTargets(edited);
    let serverTarget: unknown = { calories: 2100, proteinG: 100, carbsG: 250, fatG: 78 };
    global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        if ((global.fetch as jest.Mock).mock.calls.filter(call => call[1]?.method === 'PATCH').length === 1)
          return Promise.reject(new Error('temporary outage'));
        serverTarget = JSON.parse(String(init.body)).macroTarget;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: 'maintain' },
        macroTarget: serverTarget,
      }) });
    });
    await syncSavedProfileToServer();
    expect(await getMacroTargets()).toEqual(edited);
    await pullProfileFromServer();
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(2);
    expect(calls.at(-1)?.[1]?.method).toBeUndefined();
    expect((await getMacroTargets())?.protein).toBe('50');
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('replays a persisted failed edit on ordinary authenticated startup', async () => {
  jest.useFakeTimers();
  try {
    await AsyncStorage.clear();
    await saveMacroTargets({ calories: '640', protein: '50', carbs: '65', fat: '20' });
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await syncSavedProfileToServer();
    expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).not.toBeNull();
    jest.clearAllTimers(); // simulate process termination before its in-memory retry
    await replayPendingProfileSync();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).toBeNull();
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('keeps an offline edit for its account while another account signs in', async () => {
  jest.useFakeTimers();
  try {
    await AsyncStorage.clear();
    await saveMacroTargets({ calories: '640', protein: '50', carbs: '65', fat: '20' });
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await syncSavedProfileToServer();
    jest.clearAllTimers();
    expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).not.toBeNull();
    mockCurrentSession = { access_token: 'other-token', user: { id: 'other-user' } };
    await saveMacroTargets({ calories: '500', protein: '25', carbs: '55', fat: '20' });
    await replayPendingProfileSync();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).not.toBeNull();
    mockCurrentSession = { access_token: 'synthetic-token', user: { id: 'test-user' } };
    await replayPendingProfileSync();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).macroTarget.proteinG).toBe(175);
    expect(await AsyncStorage.getItem('@fitsy/pending_profile_sync:test-user')).toBeNull();
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('preserves the server target when syncing a legacy independent search filter', async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('@fitsy/macro_targets',
    JSON.stringify({ calories: '600', protein: '40', carbs: '60', fat: '20' }));
  await saveOnboardingField('goal', 'maintain');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await syncSavedProfileToServer();
  const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
  expect(body).not.toHaveProperty('macroTarget');
  expect(await getMacroTargets()).toBeNull();
  expect((await getQuarantinedLegacyTarget())?.mode).toBe('search');
});
