jest.unmock('react-native');
import { useMemo } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { useDiscoveryResults } from '../lib/useDiscoveryResults';
import { previewTourReady } from '../lib/previewTourReady';
import type { UseLocationResult } from '../lib/useLocation';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), startAutoRefresh() {}, stopAutoRefresh() {} } }) };
});
jest.mock('posthog-react-native', () => ({ __esModule: true, default: class { capture() {} } }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const location: UseLocationResult = { lat: 34.0407, lng: -118.2468, source: 'manual', name: 'DTLA', loading: false,
  refreshLocation: async () => null, clearManualLocation: async () => {}, setManualLocation: async () => {} };
const inputs = { calories: '600', protein: '', carbs: '', fat: '' };
const originalFetch = global.fetch;
let requests: { url: string; signal?: AbortSignal; resolve: (value: Response) => void }[];
const row = (id: string) => ({ id, name: `${id} restaurant`, address: 'Test', lat: 34.04, lng: -118.24, distanceMiles: 1, cuisineTags: [], chainFlag: false,
  bestMatch: { menuItemId: id + '-dish', name: id + ' meal', calories: 600, proteinG: 40, carbsG: 60, fatG: 20, confidence: 'HIGH', matchScore: 0 } });
function respond(index: number, id: string, extraMeta: { locked?: boolean; nextCursor?: string | null } = {}) {
  requests[index].resolve({ ok: true, status: 200, json: async () => ({ data: [row(id)], meta: { radiusMiles: 3, nearbyDishCount: 90, limit: 20, total: 1, locked: true, nextCursor: null,
    ...extraMeta } }) } as Response);
}
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  requests = [];
  global.fetch = jest.fn((url, init) => new Promise(resolve => requests.push({ url: String(url), signal: init?.signal ?? undefined, resolve }))) as typeof fetch;
});
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

it.each([true, false])('keeps all targets for ranking without requiring exact qualification (preview=%s)', async preview => {
  const targets = { calories: '500', protein: '40', carbs: '40', fat: '20' };
  const { result } = renderHook(() => useDiscoveryResults({ inputs: targets, query: `pizza-${preview}`, location, canSearch: true, targetsLoaded: true, previewReady: true, isOnboardingPreview: preview }));
  await act(async () => {});
  const params = new URL(requests[0].url).searchParams;
  expect(Object.fromEntries(params)).toMatchObject({ ...targets, q: `pizza-${preview}` });
  expect(params.has('goalMatched')).toBe(false);
  await act(async () => respond(0, 'ranked-pizza'));
  expect(result.current.results.map(r => r.id)).toEqual(['ranked-pizza']);
});

it('makes the five tips available after an empty result in a covered preview area', async () => {
  const { result } = renderHook(() => useDiscoveryResults({
    inputs, query: 'dish-that-is-absent', location, canSearch: true,
    targetsLoaded: true, previewReady: true, isOnboardingPreview: true,
  }));
  await act(async () => {});
  await act(async () => requests[0].resolve({
    ok: true, status: 200,
    json: async () => ({ data: [], meta: { radiusMiles: 3, nearbyDishCount: 90, limit: 20, total: 0, locked: true, nextCursor: null } }),
  } as Response));
  expect(result.current.results).toEqual([]);
  expect(result.current.nearbyDishCount).toBe(90);
  expect(previewTourReady({
    preview: true, locked: result.current.locked, loading: result.current.loading,
    error: result.current.error, outOfArea: result.current.outOfArea,
    fetchSeq: result.current.fetchSeq,
  })).toBe(true);
});

it.each([true, false])('ignores an old response immediately after typing, before the debounce (preview=%s)', async (preview) => {
  const { result, rerender } = renderHook(({ query }) => useDiscoveryResults({ inputs, query, location, canSearch: true, targetsLoaded: true, previewReady: true, isOnboardingPreview: preview }), { initialProps: { query: `old-${preview}` } });
  await act(async () => {});
  expect(requests).toHaveLength(1);
  rerender({ query: `new-${preview}` });
  expect(result.current.loading).toBe(true);
  expect(requests[0].signal?.aborted).toBe(true);
  await act(async () => respond(0, 'stale'));
  expect(result.current.results).toEqual([]);
  expect(result.current.loading).toBe(true);
  await act(async () => jest.advanceTimersByTime(600));
  expect(requests).toHaveLength(2);
  expect(Object.fromEntries(new URL(requests[1].url).searchParams)).toMatchObject({ q: `new-${preview}` });
  await act(async () => respond(1, 'current'));
  expect(result.current.results.map(r => r.id)).toEqual(['current']);
  expect(result.current.loading).toBe(false);
});

it('invalidates count and cancels the transport when meal targets change or the screen unmounts', async () => {
  const { result, rerender, unmount } = renderHook(({ calories }) => { const targets = useMemo(() => ({ ...inputs, calories }), [calories]); return useDiscoveryResults({ inputs: targets, query: 'targets-test', location, canSearch: true, targetsLoaded: true, previewReady: true, isOnboardingPreview: true }); }, { initialProps: { calories: '600' } });
  await act(async () => {});
  await act(async () => respond(0, 'first'));
  rerender({ calories: '700' });
  expect(result.current.loading).toBe(true);
  await act(async () => jest.advanceTimersByTime(600));
  expect(Object.fromEntries(new URL(requests[1].url).searchParams)).toMatchObject({ calories: '700' });
  unmount();
  expect(requests[1].signal?.aborted).toBe(true);
  await act(async () => respond(1, 'after-unmount'));
});


it('ends an old pagination spinner when the user starts a different search', async () => {
  const { result, rerender } = renderHook(({ query }) => useDiscoveryResults({ inputs, query, location, canSearch: true, targetsLoaded: true, previewReady: true, isOnboardingPreview: false }), { initialProps: { query: 'paging-old' } });
  await act(async () => {});
  await act(async () => respond(0, 'page-one', { locked: false, nextCursor: 'second-page' }));
  act(() => { void result.current.handleEndReached(); });
  await act(async () => {});
  expect(result.current.loadingMore).toBe(true);
  rerender({ query: 'paging-new' });
  expect(requests[1].signal?.aborted).toBe(true);
  expect(result.current.loadingMore).toBe(false);
  await act(async () => jest.advanceTimersByTime(600));
  await act(async () => respond(2, 'new-result'));
  await act(async () => respond(1, 'old-second-page', { locked: false }));
  expect(result.current.results.map(r => r.id)).toEqual(['new-result']);
  expect(result.current.loadingMore).toBe(false);
});

it('restarts from a locked first page when entitlement changes invalidate the paginated context', async () => {
  const { result } = renderHook(() => useDiscoveryResults({ inputs, query: 'expired-entitlement', location, canSearch: true, targetsLoaded: true, previewReady: true, isOnboardingPreview: false }));
  await act(async () => {});
  await act(async () => respond(0, 'pro-first-page', { locked: false, nextCursor: 'pro-cursor' }));
  act(() => { void result.current.handleEndReached(); });
  await act(async () => {});
  await act(async () => requests[1].resolve({ ok: false, status: 400, json: async () => ({ error: 'Cursor belongs to another search context' }) } as Response));
  expect(requests).toHaveLength(3);
  expect(new URL(requests[2].url).searchParams.has('cursor')).toBe(false);
  expect(result.current.loading).toBe(true);
  await act(async () => respond(2, 'locked-first-page', { locked: true, nextCursor: null }));
  expect(result.current.results.map(r => r.id)).toEqual(['locked-first-page']);
  expect(result.current.locked).toBe(true);
  expect(result.current.loadingMore).toBe(false);
});


it.each([true, false])('ends a stalled request and can retry without accepting the late response (preview=%s)', async preview => {
  const { result } = renderHook(() => useDiscoveryResults({ inputs, query: `timeout-${preview}`, location, canSearch: true, targetsLoaded: true, previewReady: true, isOnboardingPreview: preview }));
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(15_000));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toMatch(/took too long/);
  expect(requests[0].signal?.aborted).toBe(true);
  await act(async () => respond(0, 'late'));
  expect(result.current.results).toEqual([]);
  act(() => { void result.current.handleRefresh(); });
  await act(async () => {});
  expect(requests).toHaveLength(2);
  await act(async () => respond(1, 'retry-result'));
  expect(result.current.results.map(r => r.id)).toEqual(['retry-result']);
  expect(result.current.error).toBeNull();
  expect(result.current.loading).toBe(false);
});
