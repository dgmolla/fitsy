/**
 * @jest-environment node
 */
import { fetchPreviewRestaurants } from './previewSearch';
import { saveMacroTargets } from './macroStorage';

const store: Record<string, string> = {};
let mockSession: { access_token: string; user: { id: string } } | null;
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockSession } }),
    signOut: async () => { mockSession = null; },
  } }) };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; return Promise.resolve(); }),
  },
}));

const originalFetch = global.fetch;
const coords = { lat: 34.05, lng: -118.25 };
beforeEach(() => { mockSession = { access_token: 'preview-token', user: { id: 'preview-account' } }; });
afterEach(() => {
  global.fetch = originalFetch;
  Object.keys(store).forEach(key => delete store[key]);
});

it('sends a saved partial search filter in the lapsed-user preview request', async () => {
  await saveMacroTargets({ calories: '600', protein: '', carbs: '64', fat: '' }, 'search');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });

  const controller = new AbortController();
  await fetchPreviewRestaurants(coords, { signal: controller.signal, expectedUserId: 'preview-account' });

  const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
  expect(url.searchParams.get('calories')).toBe('600');
  expect(url.searchParams.get('carbs')).toBe('64');
  expect(url.searchParams.has('protein')).toBe(false);
  expect(url.searchParams.has('fat')).toBe(false);
  expect(global.fetch).toHaveBeenCalledWith(url.toString(), {
    headers: { Authorization: 'Bearer preview-token' }, signal: controller.signal,
  });
});

it('does not start a teaser cancelled while its saved area and targets load', async () => {
  global.fetch = jest.fn();
  const controller = new AbortController();
  const request = fetchPreviewRestaurants(coords, { signal: controller.signal, expectedUserId: 'preview-account' });
  controller.abort();
  await expect(request).rejects.toThrow('Preview request cancelled');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('rejects an account switch before sending the teaser', async () => {
  global.fetch = jest.fn();
  mockSession = { access_token: 'new-token', user: { id: 'new-account' } };
  await expect(fetchPreviewRestaurants(coords, { expectedUserId: 'preview-account' })).rejects.toThrow('Account changed');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('keeps the current session when the teaser was sent with an older token', async () => {
  let respond!: (value: Response) => void;
  let started!: () => void;
  const pending = new Promise<Response>(resolve => { respond = resolve; });
  const sending = new Promise<void>(resolve => { started = resolve; });
  global.fetch = jest.fn(() => { started(); return pending; });
  const request = fetchPreviewRestaurants(coords, { expectedUserId: 'preview-account' });
  await sending;
  mockSession = { access_token: 'refreshed-token', user: { id: 'preview-account' } };
  respond({ ok: false, status: 401 } as Response);
  await expect(request).rejects.toMatchObject({ status: 401, message: 'Previous account request expired' });
  expect(mockSession?.access_token).toBe('refreshed-token');
});
