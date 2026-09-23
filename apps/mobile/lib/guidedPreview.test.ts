import { fetchGuidedPreview } from './guidedPreview';
import { saveMacroTargets } from './macroStorage';

jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return jest.requireActual('../__mocks__/supabase-js');
});

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const response = { data: [], meta: { radiusMiles: 3, nearbyDishCount: 200 } };
const area = { lat: 34.0522, lng: -118.2437 };
const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response }); });
afterEach(() => { global.fetch = originalFetch; });

it('searches with the current edited meal values instead of stale persisted targets', async () => {
  await saveMacroTargets({ calories: '900', protein: '20', carbs: '90', fat: '40' });
  await fetchGuidedPreview(area, 'chicken', { calories: '600', protein: '40', carbs: '60', fat: '0' });
  const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({ guided: '1', lat: '34.0522', lng: '-118.2437', q: 'chicken', calories: '600', protein: '40', carbs: '60' });
});

it('shows area coverage without personal target claims before target setup', async () => {
  await saveMacroTargets({ calories: '900', protein: '20', carbs: '90', fat: '40' });
  await fetchGuidedPreview(area, '', null);
  const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
  expect(url.searchParams.has('calories')).toBe(false);
  expect(url.searchParams.has('protein')).toBe(false);
  expect(url.searchParams.get('lat')).toBe('34.0522');
});

it('does not turn a temporary network failure into an empty coverage result', async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await expect(fetchGuidedPreview(area)).rejects.toThrow('offline');
});

it('caches only the exact targets, craving and area without selection-count requests', async () => {
  const targets = { calories: '600', protein: '40', carbs: '60', fat: '20' };
  const first = await fetchGuidedPreview(area, 'cache-test', targets);
  expect(await fetchGuidedPreview(area, 'cache-test', targets)).toEqual(first);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await fetchGuidedPreview(area, 'changed craving', targets);
  await fetchGuidedPreview({ ...area, lat: area.lat + 0.01 }, 'cache-test', targets);
  await fetchGuidedPreview(area, 'cache-test', { ...targets, calories: '650' });
  expect(global.fetch).toHaveBeenCalledTimes(4);
  for (const [url] of (global.fetch as jest.Mock).mock.calls) {
    expect(new URL(url).searchParams.has('selectedItemId')).toBe(false);
    expect(new URL(url).searchParams.has('goalMatched')).toBe(false);
  }
});

it('revalidates expired preview results and explicit refreshes', async () => {
  const targets = { calories: '500', protein: '', carbs: '', fat: '' };
  await fetchGuidedPreview(area, 'expiry-test', targets);
  await fetchGuidedPreview(area, 'expiry-test', targets, { refresh: true });
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_001);
  try { await fetchGuidedPreview(area, 'expiry-test', targets); }
  finally { clock.mockRestore(); }
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

it('passes cancellation to the transport and never caches a cancelled response', async () => {
  const controller = new AbortController();
  const targets = { calories: '650', protein: '', carbs: '', fat: '' };
  (global.fetch as jest.Mock).mockImplementationOnce(async () => {
    controller.abort();
    return { ok: true, status: 200, json: async () => response };
  });
  await expect(fetchGuidedPreview(area, 'cancel-test', targets, { signal: controller.signal })).rejects.toThrow('cancelled');
  expect((global.fetch as jest.Mock).mock.calls[0][1].signal).toBe(controller.signal);
  await fetchGuidedPreview(area, 'cancel-test', targets);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
