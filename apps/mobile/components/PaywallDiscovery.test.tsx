jest.unmock('react-native');
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePaywallDiscovery } from '../lib/usePaywallDiscovery';
import { clearPaywallIntent, rememberPaywallIntent } from '../lib/paywallIntent';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), startAutoRefresh() {}, stopAutoRefresh() {} } }) };
});
const originalFetch = global.fetch;
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
beforeEach(async () => { await AsyncStorage.clear(); global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });

it('uses the saved selection without a search and clears it on blur', async () => {
  await rememberPaywallIntent(selection('old'));
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(result.current.selected?.name).toBe('Restaurant old'));
  await settleDiscovery();
  expect(global.fetch).not.toHaveBeenCalled();
  rerender({ focused: false });
  expect(result.current.selected).toBeUndefined();
});

it('does not retain a previous selection when refocusing after a storage failure', async () => {
  await rememberPaywallIntent(selection('old'));
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(result.current.selected?.id).toBe('old'));
  rerender({ focused: false });
  await clearPaywallIntent();
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
  await act(async () => { rerender({ focused: true }); });
  await settleDiscovery();
  expect(result.current.selected).toBeUndefined();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/restaurants/preview?lat=34.0522&lng=-118.2437'), expect.any(Object));
});

it('shows the new selection after refocusing without consulting cached search results', async () => {
  await rememberPaywallIntent(selection('old'));
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(result.current.selected?.id).toBe('old'));
  rerender({ focused: false });
  await rememberPaywallIntent(selection('new'));
  await act(async () => { rerender({ focused: true }); });
  await waitFor(() => expect(result.current.selected?.id).toBe('new'));
  await settleDiscovery();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('uses the live Los Angeles catalog when there is no preview selection', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'catalog-1', name: 'Catalog Restaurant', cuisineTags: [], distanceMiles: 1, photoUrl: 'https://example.com/catalog.jpg' }] }) });
  const { result } = renderHook(() => usePaywallDiscovery(true));
  await waitFor(() => expect(result.current.selected).toEqual({ id: 'catalog-1', name: 'Catalog Restaurant', photoUrl: 'https://example.com/catalog.jpg' }));
  expect(result.current.catalogFallback).toBe(true);
});
