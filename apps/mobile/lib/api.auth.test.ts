import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { fetchGuidedPreview } from './guidedPreview';
import { readDiscoverySignIn } from './discoverySignIn';

let mockSession: { access_token: string; user: { id: string } } | null;
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: mockSession } }),
  signOut: async () => { mockSession = null; },
} }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const originalFetch = global.fetch;
const preview = { data: [], meta: { radiusMiles: 3, nearbyDishCount: 1 } };
beforeEach(async () => {
  await AsyncStorage.clear();
  mockSession = { access_token: 'refreshed-access-token', user: { id: 'mobile-account' } };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => preview });
});
afterEach(() => { global.fetch = originalFetch; });

test.each(['/api/restaurants?lat=34&lng=-118', '/api/restaurants/preview', '/api/restaurants/stats',
  '/api/restaurants/restaurant-id/menu', '/api/flags'])('%s sends the current SDK token by default', async path => {
  await api.get(path);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(path), expect.objectContaining({
    headers: { Authorization: 'Bearer refreshed-access-token' },
  }));
});

test('guided preview includes a Bearer token and never reuses another account or signed-out cache', async () => {
  const area = { lat: 31, lng: -111 };
  await fetchGuidedPreview(area, 'account-cache', null);
  await fetchGuidedPreview(area, 'account-cache', null);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  mockSession = { access_token: 'other-token', user: { id: 'other-account' } };
  await fetchGuidedPreview(area, 'account-cache', null);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(global.fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ headers: { Authorization: 'Bearer other-token' } }));
  mockSession = null;
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });
  await expect(fetchGuidedPreview(area, 'account-cache', null)).rejects.toMatchObject({ status: 401 });
  expect(await readDiscoverySignIn()).toBe('/welcome/preview');
});

test('a rejected menu session preserves its destination for sign-in without returning data', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });
  await expect(api.get('/api/restaurants/restaurant-id/menu?calories=600')).rejects.toMatchObject({ status: 401 });
  expect(await readDiscoverySignIn()).toBe('/restaurant/restaurant-id');
});
