/**
 * @jest-environment node
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: jest.fn().mockResolvedValue(null) },
}));
import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchMenu, fetchMenuOutcome } from './apiClient';
import type { MenuApiResponseBody, MenuResponse } from '@fitsy/shared';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

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

const sampleMenuResponse: MenuResponse = {
  restaurantId: 'r1',
  restaurantName: 'Test Bistro',
  locked: false,
  totalItemCount: 2,
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
  beforeEach(() => { (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null); });

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

  it('keeps the selected dish and meal targets on every page of a full menu', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ calories: '600', protein: '40', carbs: '60', fat: '20' }));
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { ...sampleMenuResponse, menuItems: [sampleMenuResponse.menuItems[0]], nextCursor: 'next-page', totalItemCount: 2 } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { ...sampleMenuResponse, menuItems: [sampleMenuResponse.menuItems[1]], nextCursor: null, totalItemCount: 2 } }) });
    const result = await fetchMenu('r1', { selectedItemId: 'mi1' });
    expect(result?.menuItems.map(item => item.id)).toEqual(['mi1', 'mi2']);
    const urls = (global.fetch as jest.Mock).mock.calls.map(call => new URL(call[0]));
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url.searchParams.get('selectedItemId')).toBe('mi1');
      expect(url.searchParams.get('calories')).toBe('600');
      expect(url.searchParams.get('protein')).toBe('40');
    }
    expect(urls[1]!.searchParams.get('cursor')).toBe('next-page');
  });

  it('does not paginate a locked menu even if a cursor is present', async () => {
    global.fetch = makeMockFetch({ ok: true, body: { data: { ...sampleMenuResponse, locked: true, nextCursor: 'ignored' } } });
    expect((await fetchMenu('r1'))?.locked).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends selection, targets and cursors on the native URLSearchParams without size', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
    Object.defineProperty(URLSearchParams.prototype, 'size', { configurable: true, get: () => undefined });
    try {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ calories: '600' }));
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { ...sampleMenuResponse, menuItems: [sampleMenuResponse.menuItems[0]], nextCursor: 'second' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { ...sampleMenuResponse, menuItems: [sampleMenuResponse.menuItems[1]], nextCursor: null } }) });
      const result = await fetchMenu('r1', { selectedItemId: 'mi1' });
      const urls = (global.fetch as jest.Mock).mock.calls.map(call => new URL(call[0]));
      expect(result?.menuItems.map(item => item.id)).toEqual(['mi1', 'mi2']);
      expect(urls[1]!.searchParams.get('cursor')).toBe('second');
      for (const url of urls) {
        expect(url.searchParams.get('selectedItemId')).toBe('mi1');
        expect(url.searchParams.get('calories')).toBe('600');
      }
    } finally {
      if (descriptor) Object.defineProperty(URLSearchParams.prototype, 'size', descriptor);
      else Reflect.deleteProperty(URLSearchParams.prototype, 'size');
    }
  });

  it('preserves available dishes and a retry cursor when a later page fails', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { ...sampleMenuResponse, menuItems: [sampleMenuResponse.menuItems[0]], nextCursor: 'second' } }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'Temporarily unavailable' }) });
    const result = await fetchMenu('r1');
    expect(result?.menuItems.map(item => item.id)).toEqual(['mi1']);
    expect(result?.nextCursor).toBe('second');
  });

  it('stops a repeated cursor without duplicating dishes or claiming a complete menu', async () => {
    global.fetch = makeMockFetch({ ok: true, body: { data: { ...sampleMenuResponse, nextCursor: 'repeated' } } });
    const result = await fetchMenu('r1');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result?.menuItems).toHaveLength(2);
    expect(result?.nextCursor).toBe('repeated');
  });

  it('discards unlocked pages when the next page locks or rejects access', async () => {
    const first = { ...sampleMenuResponse, nextCursor: 'second' };
    const locked = { ...sampleMenuResponse, locked: true, menuItems: [] };
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: first }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: locked }) });
    expect(await fetchMenu('r1')).toEqual(locked);
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: first }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Access expired' }) });
    expect(await fetchMenu('r1')).toBeNull();
  });

  it('returns null on API error response', async () => {
    global.fetch = makeMockFetch({ ok: false, status: 404, body: { error: 'Not found' } });

    const result = await fetchMenu('not-exist');

    expect(result).toBeNull();
  });

  it('distinguishes a temporary first-page failure from an explicit rejection for Retry', async () => {
    global.fetch = makeMockFetch({ ok: false, status: 503 });
    expect(await fetchMenuOutcome('r1')).toEqual({ menu: null, error: 'transient' });
    global.fetch = makeMockFetch({ ok: false, status: 403 });
    expect(await fetchMenuOutcome('r1')).toEqual({ menu: null, error: 'unavailable' });
    global.fetch = makeMockFetch({ ok: false, status: 401 });
    expect(await fetchMenuOutcome('r1')).toEqual({ menu: null, error: 'unavailable' });
    global.fetch = makeMockFetch({ ok: true, body: { error: 'Access unavailable' } });
    expect(await fetchMenuOutcome('r1')).toEqual({ menu: null, error: 'unavailable' });
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

