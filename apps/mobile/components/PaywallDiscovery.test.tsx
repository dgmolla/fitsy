jest.unmock('react-native');
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePaywallDiscovery } from '../lib/usePaywallDiscovery';
import { clearPaywallIntent, rememberPaywallIntent } from '../lib/paywallIntent';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockSessionId: string | null = null;
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: mockSessionId ? { user: { id: mockSessionId } } : null } }), startAutoRefresh() {}, stopAutoRefresh() {} } }) };
});
const originalFetch = global.fetch;
const resultFor = (id: string) => ({ id, name: `Restaurant ${id}`, address: '123 Main', lat: 34.0869, lng: -118.2702,
  distanceMiles: 1, cuisineTags: [], chainFlag: false, photoUrl: 'https://example.com/restaurant.jpg',
  bestMatch: { menuItemId: `meal-${id}`, name: 'Real meal', calories: 500, proteinG: 40, carbsG: 40, fatG: 20,
    confidence: 'HIGH' as const, matchScore: 0.2, nutritionBasis: 'estimated' as const } });
const selection = (id: string) => ({
  action: 'menu' as const,
  restaurantId: id,
  restaurantName: `Restaurant ${id}`,
  menuItemId: `meal-${id}`,
  area: { lat: 34.0869, lng: -118.2702 },
  areaName: 'Silver Lake',
  query: `pizza ${id}`,
  targets: { calories: '500', protein: '40', carbs: '40', fat: '20' },
});
async function settleDiscovery() {
  await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
}
beforeEach(async () => { mockSessionId = null; await AsyncStorage.clear(); global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });

it('uses the saved selection without a search and clears it on blur', async () => {
  await rememberPaywallIntent({ ...selection('old'), previewResult: resultFor('old') });
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(result.current.selected?.name).toBe('Restaurant old'));
  await settleDiscovery();
  expect(global.fetch).not.toHaveBeenCalled();
  rerender({ focused: false });
  expect(result.current.selected).toBeUndefined();
});

it('clears a focused preview immediately when its account signs out or changes', async () => {
  mockSessionId = 'owner-a';
  await rememberPaywallIntent({ ...selection('old'), previewResult: resultFor('old') });
  const { result, rerender } = renderHook(({ userId }) => usePaywallDiscovery(true, userId), { initialProps: { userId: 'owner-a' as string | null } });
  await waitFor(() => expect(result.current.selected?.id).toBe('old'));
  mockSessionId = null;
  rerender({ userId: null });
  expect(result.current.selected).toBeUndefined();
  mockSessionId = 'owner-b';
  await rememberPaywallIntent({ ...selection('new'), previewResult: resultFor('new') });
  rerender({ userId: 'owner-b' });
  await waitFor(() => expect(result.current.selected?.id).toBe('new'));
});

it('does not retain a previous selection when refocusing after a storage failure', async () => {
  await rememberPaywallIntent({ ...selection('old'), previewResult: resultFor('old') });
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(result.current.selected?.id).toBe('old'));
  rerender({ focused: false });
  await clearPaywallIntent();
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
  await act(async () => { rerender({ focused: true }); });
  await settleDiscovery();
  expect(result.current.selected).toBeUndefined();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('guided=1&lat=34.0522&lng=-118.2437'), expect.any(Object));
});

it('shows the new selection after refocusing without consulting cached search results', async () => {
  await rememberPaywallIntent({ ...selection('old'), previewResult: resultFor('old') });
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(result.current.selected?.id).toBe('old'));
  rerender({ focused: false });
  await rememberPaywallIntent({ ...selection('new'), previewResult: resultFor('new') });
  await act(async () => { rerender({ focused: true }); });
  await waitFor(() => expect(result.current.selected?.id).toBe('new'));
  await settleDiscovery();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('uses the live Los Angeles catalog when there is no preview selection', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ data: [{ ...resultFor('catalog-1'), name: 'Catalog Restaurant' }], meta: { nearbyDishCount: 1, radiusMiles: 3 } }) });
  const { result } = renderHook(() => usePaywallDiscovery(true));
  await waitFor(() => expect(result.current.selected).toMatchObject({ id: 'catalog-1', name: 'Catalog Restaurant', bestMatch: { name: 'Real meal' } }));
  expect(result.current.catalogFallback).toBe(true);
});

it('retries the real catalog without a saved query when that query has no matches', async () => {
  await rememberPaywallIntent(selection('missing'));
  (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({ ok: true, json: async () => ({
    data: [...new URL(url).searchParams].some(([key, value]) => key === 'q' && value) ? [] : [resultFor('catalog-2')],
    meta: { nearbyDishCount: 1, radiusMiles: 3 },
  }) }));
  const { result } = renderHook(() => usePaywallDiscovery(true));
  await waitFor(() => expect(result.current.selected?.id).toBe('catalog-2'));
  expect(result.current.catalogFallback).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('ignores an old catalog response after payment loses focus and returns with a new selection', async () => {
  await rememberPaywallIntent(selection('old'));
  let resolveOld!: (value: unknown) => void;
  (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  rerender({ focused: false });
  await rememberPaywallIntent({ ...selection('new'), previewResult: resultFor('new') });
  rerender({ focused: true });
  await waitFor(() => expect(result.current.selected?.id).toBe('new'));
  await act(async () => { resolveOld({ ok: true, json: async () => ({ data: [resultFor('old')], meta: { nearbyDishCount: 1, radiusMiles: 3 } }) }); });
  expect(result.current.selected?.id).toBe('new');
});
