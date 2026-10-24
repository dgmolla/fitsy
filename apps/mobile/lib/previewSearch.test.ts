/**
 * @jest-environment node
 */
import { fetchPreviewRestaurants } from './previewSearch';
import { saveMacroTargets } from './macroStorage';

const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; return Promise.resolve(); }),
  },
}));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  Object.keys(store).forEach(key => delete store[key]);
});

it('sends a saved partial search filter in the lapsed-user preview request', async () => {
  await saveMacroTargets({ calories: '600', protein: '', carbs: '64', fat: '' }, 'search');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });

  await fetchPreviewRestaurants({ lat: 34.05, lng: -118.25 });

  const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
  expect(url.searchParams.get('calories')).toBe('600');
  expect(url.searchParams.get('carbs')).toBe('64');
  expect(url.searchParams.has('protein')).toBe(false);
  expect(url.searchParams.has('fat')).toBe(false);
});
