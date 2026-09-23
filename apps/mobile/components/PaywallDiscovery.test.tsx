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
const selection = (id: string) => ({ action: 'menu' as const, restaurantId: id, restaurantName: `Restaurant ${id}` });
beforeEach(async () => { await AsyncStorage.clear(); global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });

it('uses the saved selection without a search and clears it on blur', async () => {
  await rememberPaywallIntent(selection('old'));
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(result.current.selected?.name).toBe('Restaurant old'));
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
  expect(result.current.selected).toBeUndefined();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('shows the new selection after refocusing without consulting cached search results', async () => {
  await rememberPaywallIntent(selection('old'));
  const { result, rerender } = renderHook(({ focused }) => usePaywallDiscovery(focused), { initialProps: { focused: true } });
  await waitFor(() => expect(result.current.selected?.id).toBe('old'));
  rerender({ focused: false });
  await rememberPaywallIntent(selection('new'));
  await act(async () => { rerender({ focused: true }); });
  await waitFor(() => expect(result.current.selected?.id).toBe('new'));
  expect(global.fetch).not.toHaveBeenCalled();
});
