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
  expect(Object.fromEntries(url.searchParams)).toEqual({ guided: '1', lat: '34.0522', lng: '-118.2437', q: 'chicken', calories: '600', protein: '40', carbs: '60', fat: '0' });
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
