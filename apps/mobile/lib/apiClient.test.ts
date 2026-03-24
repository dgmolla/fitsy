/**
 * @jest-environment node
 */
import { fetchRestaurants } from './apiClient';
import type { RestaurantsResponse } from '@fitsy/shared';

const BASE_URL = 'http://localhost:3000';

function makeMockFetch(options: {
  ok: boolean;
  status?: number;
  body?: unknown;
}) {
  return jest.fn().mockResolvedValue({
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 500),
    json: jest.fn().mockResolvedValue(options.body ?? {}),
  });
}

const sampleRestaurant = {
  id: 'r1',
  name: 'Test Bistro',
  address: '123 Main St',
  lat: 34.0869,
  lng: -118.3269,
  distanceMiles: 0.5,
  cuisineTags: ['american'],
  chainFlag: false,
  bestMatch: null,
};

describe('fetchRestaurants', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('builds correct URL with all four macro params', async () => {
    const mockBody: RestaurantsResponse = {
      data: [sampleRestaurant],
      meta: { total: 1, limit: 20 },
    };
    global.fetch = makeMockFetch({ ok: true, body: mockBody });

    await fetchRestaurants({
      protein: 40,
      carbs: 50,
      fat: 20,
      calories: 500,
      lat: 34.0869,
      lng: -118.3269,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl: string = (global.fetch as jest.Mock).mock.calls[0][0];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('protein')).toBe('40');
    expect(url.searchParams.get('carbs')).toBe('50');
    expect(url.searchParams.get('fat')).toBe('20');
    expect(url.searchParams.get('calories')).toBe('500');
    expect(url.searchParams.get('lat')).toBe('34.0869');
    expect(url.searchParams.get('lng')).toBe('-118.3269');
  });

  it('omits undefined macro params from query string', async () => {
    const mockBody: RestaurantsResponse = {
      data: [],
      meta: { total: 0, limit: 20 },
    };
    global.fetch = makeMockFetch({ ok: true, body: mockBody });

    await fetchRestaurants({ protein: 30 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl: string = (global.fetch as jest.Mock).mock.calls[0][0];
    const url = new URL(calledUrl);
    expect(url.searchParams.has('protein')).toBe(true);
    expect(url.searchParams.has('carbs')).toBe(false);
    expect(url.searchParams.has('fat')).toBe(false);
    expect(url.searchParams.has('calories')).toBe(false);
  });

  it('returns empty array on API error response (non-ok)', async () => {
    global.fetch = makeMockFetch({ ok: false, status: 500, body: { error: 'Server error' } });

    const result = await fetchRestaurants({ protein: 30 });

    expect(result).toEqual([]);
  });

  it('returns parsed RestaurantResult[] on success', async () => {
    const mockBody: RestaurantsResponse = {
      data: [sampleRestaurant],
      meta: { total: 1, limit: 20 },
    };
    global.fetch = makeMockFetch({ ok: true, body: mockBody });

    const result = await fetchRestaurants({ protein: 40, calories: 500 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
    expect(result[0].name).toBe('Test Bistro');
  });
});
