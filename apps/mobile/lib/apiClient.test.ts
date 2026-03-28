/**
 * @jest-environment node
 */
jest.mock('./authClient', () => ({
  getStoredToken: jest.fn().mockResolvedValue('test-token'),
}));

import { fetchMenu, fetchRestaurants } from './apiClient';
import type { MenuApiResponseBody, MenuResponse, RestaurantsResponse } from '@fitsy/shared';

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
  lat: 34.0868,
  lng: -118.3273,
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
      lat: 34.0868,
      lng: -118.3273,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl: string = (global.fetch as jest.Mock).mock.calls[0][0];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('protein')).toBe('40');
    expect(url.searchParams.get('carbs')).toBe('50');
    expect(url.searchParams.get('fat')).toBe('20');
    expect(url.searchParams.get('calories')).toBe('500');
    expect(url.searchParams.get('lat')).toBe('34.0868');
    expect(url.searchParams.get('lng')).toBe('-118.3273');
  });

  it('omits undefined macro params from query string', async () => {
    const mockBody: RestaurantsResponse = {
      data: [],
      meta: { total: 0, limit: 20 },
    };
    global.fetch = makeMockFetch({ ok: true, body: mockBody });

    await fetchRestaurants({ protein: 30, lat: 34.0868, lng: -118.3273 });

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

    const result = await fetchRestaurants({ protein: 30, lat: 34.0868, lng: -118.3273 });

    expect(result).toEqual([]);
  });

  it('returns parsed RestaurantResult[] on success', async () => {
    const mockBody: RestaurantsResponse = {
      data: [sampleRestaurant],
      meta: { total: 1, limit: 20 },
    };
    global.fetch = makeMockFetch({ ok: true, body: mockBody });

    const result = await fetchRestaurants({ protein: 40, calories: 500, lat: 34.0868, lng: -118.3273 });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('r1');
    expect(result[0]!.name).toBe('Test Bistro');
  });
});

const sampleMenuResponse: MenuResponse = {
  restaurantId: 'r1',
  restaurantName: 'Test Bistro',
  menuItems: [
    {
      id: 'mi1',
      name: 'Grilled Chicken',
      category: 'Entrees',
      price: 12.99,
      macros: {
        calories: 420,
        proteinG: 45,
        carbsG: 10,
        fatG: 18,
        confidence: 'HIGH',
        hadPhoto: false,
        estimatedAt: '2024-01-01T00:00:00Z',
      },
    },
    {
      id: 'mi2',
      name: 'House Salad',
      category: 'Starters',
      macros: null,
    },
  ],
};

describe('fetchMenu', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('calls the correct URL', async () => {
    const mockBody: MenuApiResponseBody = { data: sampleMenuResponse };
    global.fetch = makeMockFetch({ ok: true, body: mockBody });

    await fetchMenu('r1');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl: string = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(calledUrl).toBe(`${BASE_URL}/api/restaurants/r1/menu`);
  });

  it('returns MenuResponse on success', async () => {
    const mockBody: MenuApiResponseBody = { data: sampleMenuResponse };
    global.fetch = makeMockFetch({ ok: true, body: mockBody });

    const result = await fetchMenu('r1');

    expect(result).not.toBeNull();
    expect(result?.restaurantId).toBe('r1');
    expect(result?.restaurantName).toBe('Test Bistro');
    expect(result?.menuItems).toHaveLength(2);
  });

  it('returns null on API error response', async () => {
    global.fetch = makeMockFetch({ ok: false, status: 404, body: { error: 'Not found' } });

    const result = await fetchMenu('not-exist');

    expect(result).toBeNull();
  });

  it('returns null when API returns error shape', async () => {
    global.fetch = makeMockFetch({ ok: true, body: { error: 'Something went wrong' } });

    const result = await fetchMenu('r1');

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

    const result = await fetchMenu('r1');

    expect(result).toBeNull();
  });
});
