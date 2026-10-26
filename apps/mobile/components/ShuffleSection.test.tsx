import { act, deferred, fireEvent, getPaywallIntent, installPurchasedAccount, mockState, renderJourney, response, routes, saveOnboardingField, SecureStore, waitFor, withAccountProfile } from './OnboardingNavigationHarness';
import React, { useState } from 'react';
import { Button, Text } from 'react-native';
import PostHog from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import type { ShuffleResponse } from '@fitsy/shared';
import { ShuffleSection } from './ShuffleSection';
import { usePurchases } from '../lib/usePurchases';
import { __resetForTesting } from '../lib/analytics';
import type { MacroValues } from '../lib/macroPresets';
import { shuffleTargets } from '../lib/shuffle';
import { saveDiscoveryMacroTargets } from '../lib/macroStorage';
import { MANUAL_LOCATION_KEY } from '../lib/useLocation';
import Search from '../app/(tabs)/search';
import Restaurant from '../app/restaurant/[id]';
import { DiscoveryScreen } from './DiscoveryScreen';

jest.mock('expo-haptics', () => ({ impactAsync: jest.fn().mockResolvedValue(undefined), ImpactFeedbackStyle: { Light: 'light' } }));

const values: MacroValues = { calories: '600', protein: '40', carbs: '60', fat: '20' };
const meal: ShuffleResponse = {
  data: { restaurant: { id: 'seed-bowl', name: 'Seed Bowl Co #01', address: 'Seed St', lat: 34.04, lng: -118.24,
    distanceMiles: 1.25, cuisineTags: ['american'], chainFlag: true },
  item: { id: 'chicken', name: 'Grilled Chicken Bowl' },
  macros: { calories: 520, proteinG: 42, carbsG: 48, fatG: 14, confidence: 'HIGH', nutritionBasis: 'estimated' },
  fitScore: 0.9, distanceMiles: 1.25, availability: 'unknown' },
  meta: { locked: false, radiusMiles: 3, fallback: 'none', tolerance: 0.1, emptyReason: null },
};
const empty: ShuffleResponse = { data: null, meta: { ...meal.meta, emptyReason: 'no_matches', radiusMiles: 6, fallback: 'radius', tolerance: 0.25 } };
let flag: boolean | string | undefined;
let flagListeners: Set<() => void>;
let requests: { url: URL; init?: RequestInit }[];
let answer: (url: URL, init?: RequestInit) => Promise<Response>;
let accountEntitled: boolean;
const unsubscribe = jest.fn();

beforeEach(async () => {
  await installPurchasedAccount();
  __resetForTesting();
  flag = true;
  accountEntitled = true;
  flagListeners = new Set();
  unsubscribe.mockReset();
  jest.mocked(Haptics.impactAsync).mockClear().mockResolvedValue(undefined);
  jest.mocked(PostHog).mockImplementation(() => ({
    capture() {}, identify() {},
    getFeatureFlag: (name: string) => name === 'shuffle' ? flag : false,
    onFeatureFlags: (callback: () => void) => {
      flagListeners.add(callback);
      return () => { unsubscribe(); flagListeners.delete(callback); };
    },
  }) as unknown as PostHog);
  requests = [];
  answer = async () => response(meal);
  global.fetch = jest.fn(withAccountProfile(async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/api/restaurants/shuffle') {
      requests.push({ url, init });
      return answer(url, init);
    }
    if (url.pathname === '/api/restaurants' || url.pathname === '/api/restaurants/guided-preview')
      return response({ data: [], meta: { locked: false, total: 0, limit: 20, nearbyDishCount: 1, radiusMiles: 3 } });
    if (url.pathname === '/api/saved-items') return response({ data: [] });
    if (url.pathname === '/api/restaurants/seed-bowl/menu') return response({ data: {
      restaurantId: 'seed-bowl', restaurantName: 'Seed Bowl Co #01', locked: false, totalItemCount: 1,
      menuItems: [{ id: 'chicken', name: 'Grilled Chicken Bowl', category: 'Bowls',
        macros: { ...meal.data!.macros, hadPhoto: false, estimatedAt: '2026-10-24T00:00:00Z' } }],
    } });
    return response({ active: accountEntitled, verdict: accountEntitled ? 'active' : 'never_subscribed', synced: true, stale: false,
      lastRcVerifiedAt: new Date().toISOString(), expiresAt: '2030-01-08T12:00:00Z' });
  }));
});

function Fixture({ initial = values, locating = false }: { initial?: MacroValues; locating?: boolean }) {
  const [targets, setTargets] = useState(initial);
  const [lat, setLat] = useState(34.04);
  const { entitled } = usePurchases();
  return <>
    <Text testID="access">{String(entitled)}</Text>
    <ShuffleSection values={targets} lat={lat} lng={-118.24} locating={locating} onEditTargets={() => setTargets({ ...values, calories: '700' })} />
    <Button title="Change targets" onPress={() => setTargets({ ...values, calories: '800' })} />
    <Button title="Change location" onPress={() => setLat(35)} />
  </>;
}
function MenuDestination() {
  const params = useLocalSearchParams();
  return <Text testID="destination">{JSON.stringify(params)}</Text>;
}
async function setup(props: Parameters<typeof Fixture>[0] = {}) {
  const screen = renderJourney('/search?shuffleSeed=maestro-shuffle', {
    ...routes, '(tabs)/search': () => <Fixture {...props} />, 'restaurant/[id]': MenuDestination,
  });
  await waitFor(() => expect(screen.getByTestId('access').props.children).toBe(String(accountEntitled)));
  return screen;
}
async function press(screen: Awaited<ReturnType<typeof setup>>, id = 'shuffle-button') {
  await act(async () => { fireEvent.press(screen.getByTestId(id)); });
}

it.each([undefined, false, 'control', 'true'])('hides Shuffle and performs no request when the PostHog flag is %s', async value => {
  flag = value;
  const screen = await setup();
  expect(screen.queryByTestId('shuffle-section')).toBeNull();
  expect(requests).toHaveLength(0);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

it('subscribes to live flag updates, cancels a pending pick when disabled, and unsubscribes', async () => {
  flag = undefined;
  const pending = deferred<Response>();
  answer = () => pending.promise;
  const screen = await setup();
  act(() => { flag = true; flagListeners.forEach(listener => listener()); });
  await press(screen);
  expect(screen.getByTestId('shuffle-loading')).toBeTruthy();
  act(() => { flag = false; flagListeners.forEach(listener => listener()); });
  expect(requests[0].init?.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(response(meal)));
  expect(screen.queryByTestId('shuffle-result')).toBeNull();
  screen.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('shows a real response with all macros, provenance, distance and haptics, then opens the selected dish', async () => {
  const screen = await setup();
  await press(screen);
  expect(screen.getByTestId('shuffle-restaurant').props.children).toBe('Seed Bowl Co #01');
  expect(screen.getByTestId('shuffle-dish').props.children).toBe('Grilled Chicken Bowl');
  for (const macro of ['≈520 kcal', '≈42 g protein', '≈48 g carbs', '≈14 g fat']) expect(screen.getByText(macro)).toBeTruthy();
  expect(screen.getByText('Estimated nutrition · high confidence')).toBeTruthy();
  expect(screen.getByText('1.3 mi away')).toBeTruthy();
  expect(screen.getByText('Check opening hours before you go.')).toBeTruthy();
  expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  expect(Object.fromEntries(requests[0].url.searchParams)).toMatchObject({ ...values, lat: '34.04', lng: '-118.24', seed: 'maestro-shuffle:0' });
  expect(requests[0].init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  await press(screen, 'shuffle-view-menu');
  expect(screen.getPathname()).toBe('/restaurant/seed-bowl');
  expect(JSON.parse(screen.getByTestId('destination').props.children)).toMatchObject({ selectedItemId: 'chicken', distance: '1.3' });
});

it('excludes recent dishes and uses a fresh seed on Shuffle again', async () => {
  const screen = await setup();
  await press(screen);
  answer = async () => response({ ...meal, data: { ...meal.data!, item: { id: 'salmon', name: 'Salmon Plate' } } });
  await press(screen, 'shuffle-again');
  expect(Object.fromEntries(requests[1].url.searchParams)).toMatchObject({ excludeRecent: 'chicken', seed: 'maestro-shuffle:1' });
  expect(screen.getByTestId('shuffle-dish').props.children).toBe('Salmon Plate');
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
});

it('recycles the pool once after exhausting recent picks without reporting a false nearby empty', async () => {
  const screen = await setup();
  await press(screen);
  answer = async url => response(url.searchParams.has('excludeRecent') ? empty : meal);
  await press(screen, 'shuffle-again');
  expect(requests).toHaveLength(3);
  expect(requests[2].url.searchParams.has('excludeRecent')).toBe(false);
  expect(screen.queryByTestId('shuffle-empty')).toBeNull();
  expect(screen.getByTestId('shuffle-dish')).toBeTruthy();
});

it('shows an explicit empty with target recovery, then clears it when targets change', async () => {
  answer = async () => response(empty);
  const screen = await setup();
  await press(screen);
  expect(screen.getByText('Nothing fits nearby')).toBeTruthy();
  expect(screen.queryByTestId('shuffle-view-menu')).toBeNull();
  await press(screen, 'shuffle-edit-targets');
  expect(screen.queryByTestId('shuffle-empty')).toBeNull();
  answer = async () => response(meal);
  await press(screen);
  expect(Object.fromEntries(requests[1].url.searchParams).calories).toBe('700');
});

it('keeps the server-locked teaser redacted and carries the restaurant into the existing paywall route', async () => {
  // Even a malformed locked response containing paid details must not expose them.
  answer = async () => response({ ...meal, meta: { ...meal.meta, locked: true, fallback: null, tolerance: null } });
  const screen = await setup();
  await press(screen);
  expect(screen.getByTestId('shuffle-locked')).toBeTruthy();
  expect(screen.getByTestId('shuffle-restaurant')).toBeTruthy();
  expect(screen.queryByTestId('shuffle-dish')).toBeNull();
  expect(screen.queryByTestId('shuffle-macros')).toBeNull();
  expect(screen.queryByText('Grilled Chicken Bowl')).toBeNull();
  mockState.session = null;
  await press(screen, 'shuffle-view-menu');
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
});

it.each([true, false])('shows a redacted teaser for a non-subscriber (anonymous=%s)', async anonymous => {
  accountEntitled = false;
  if (anonymous) mockState.session = null;
  answer = async () => response({ ...meal, data: { ...meal.data!, item: null, macros: null, fitScore: null },
    meta: { ...meal.meta, locked: true, fallback: null, tolerance: null } });
  const screen = await setup();
  await press(screen);
  expect(screen.getByTestId('shuffle-locked')).toBeTruthy();
  expect(screen.queryByTestId('shuffle-macros')).toBeNull();
  if (anonymous) expect(requests[0].init?.headers).toEqual({});
  await press(screen, 'shuffle-view-menu');
  await waitFor(() => expect(screen.getPathname()).toBe(anonymous ? '/welcome/signin' : '/welcome/payment'));
  expect(await getPaywallIntent()).toMatchObject({ action: 'menu', restaurantId: 'seed-bowl', restaurantName: 'Seed Bowl Co #01' });
});

it.each(['network', 'rate limit', 'invalid response'] as const)('distinguishes %s from no eligible nearby meals and retries', async failure => {
  answer = async () => {
    if (failure === 'network') throw new Error('offline');
    return failure === 'rate limit' ? { ...response({ error: 'Too many requests' }), ok: false, status: 429 }
      : response({ unexpected: true });
  };
  const screen = await setup();
  await press(screen);
  expect(screen.getByTestId('shuffle-error')).toBeTruthy();
  expect(screen.queryByTestId('shuffle-empty')).toBeNull();
  if (failure === 'rate limit') expect(screen.getByText('A few too many shuffles. Wait a moment, then try again.')).toBeTruthy();
  answer = async () => response(meal);
  await press(screen, 'shuffle-again');
  expect(screen.queryByTestId('shuffle-error')).toBeNull();
  expect(screen.getByTestId('shuffle-result')).toBeTruthy();
});

it('prevents concurrent shuffles and tolerates unavailable haptics', async () => {
  jest.mocked(Haptics.impactAsync).mockRejectedValue(new Error('no haptics'));
  const pending = deferred<Response>();
  answer = () => pending.promise;
  const screen = await setup();
  await press(screen);
  await press(screen);
  expect(requests).toHaveLength(1);
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(response(meal)));
  expect(screen.getByTestId('shuffle-result')).toBeTruthy();
});

it.each(['Change targets', 'Change location'])('aborts and ignores a stale response after %s', async action => {
  const pending = deferred<Response>();
  answer = () => pending.promise;
  const screen = await setup();
  await press(screen);
  await act(async () => fireEvent.press(screen.getByText(action)));
  expect(requests[0].init?.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(response(meal)));
  expect(screen.queryByTestId('shuffle-result')).toBeNull();
  answer = async () => response(meal);
  await press(screen);
  const query = Object.fromEntries(requests[1].url.searchParams);
  expect(query.excludeRecent).toBeUndefined();
  expect(query[action === 'Change targets' ? 'calories' : 'lat']).toBe(action === 'Change targets' ? '800' : '35');
});

it('clears paid data on sign-out', async () => {
  const screen = await setup();
  await press(screen);
  await act(async () => {
    mockState.session = null;
    mockState.authListeners.forEach(listener => listener('SIGNED_OUT', null));
  });
  expect(screen.queryByTestId('shuffle-result')).toBeNull();
});

it('ignores an old account response even without an auth event', async () => {
  const pending = deferred<Response>();
  answer = () => pending.promise;
  const screen = await setup();
  await press(screen);
  mockState.session = { access_token: 'other-token', user: { id: 'other-account' } };
  await act(async () => pending.resolve(response(meal)));
  expect(screen.queryByTestId('shuffle-result')).toBeNull();
  expect(screen.getByTestId('shuffle-error')).toBeTruthy();
});

it('bounds a stalled request and offers retry rather than reporting no matches', async () => {
  // A native transport may ignore AbortSignal; the visible retry still settles.
  const pending = deferred<Response>();
  answer = () => pending.promise;
  const screen = await setup();
  await press(screen);
  await act(async () => jest.advanceTimersByTime(12_000));
  expect(requests[0].init?.signal?.aborted).toBe(true);
  expect(screen.getByTestId('shuffle-error')).toBeTruthy();
  expect(screen.queryByTestId('shuffle-empty')).toBeNull();
  answer = async () => response(meal);
  await press(screen, 'shuffle-again');
  expect(screen.getByTestId('shuffle-result')).toBeTruthy();
  await act(async () => pending.resolve(response(empty)));
  expect(screen.queryByTestId('shuffle-empty')).toBeNull();
});

it('requires a target and a settled location, preserves explicit zero budgets, and omits unspecified dimensions', async () => {
  expect(shuffleTargets({ calories: '0', protein: '', carbs: ' ', fat: 'invalid' })).toEqual({ calories: 0 });
  expect(shuffleTargets({ calories: '-1', protein: 'Infinity', carbs: '', fat: '' })).toEqual({});
  const screen = await setup({ initial: { calories: '', protein: '', carbs: '', fat: '' }, locating: true });
  await press(screen);
  expect(requests).toHaveLength(0);
  expect(screen.getByText('Set a meal target to find your first pick.')).toBeTruthy();
  expect(screen.getByTestId('shuffle-edit-targets')).toBeTruthy();
  screen.unmount();
  const zero = await setup({ initial: { calories: '0', protein: '', carbs: '', fat: '' } });
  await press(zero);
  expect(Object.fromEntries(requests[0].url.searchParams).calories).toBe('0');
  for (const key of ['protein', 'carbs', 'fat', 'q']) expect(requests[0].url.searchParams.has(key)).toBe(false);
});

it.each(['tolerance', 'radius'] as const)('discloses %s fallback and published nutrition', async fallback => {
  answer = async () => response({ ...meal, data: { ...meal.data!, macros: { ...meal.data!.macros!, nutritionBasis: 'published' } },
    meta: { ...meal.meta, fallback, radiusMiles: 6, tolerance: 0.25 } });
  const screen = await setup();
  await press(screen);
  expect(screen.getByText('520 kcal')).toBeTruthy();
  expect(screen.getByText('Published nutrition · high confidence')).toBeTruthy();
  expect(screen.getByText(fallback === 'radius' ? 'Search widened to 6 miles with a wider macro range.' : 'This pick uses a wider macro range.')).toBeTruthy();
});

it('uses persisted targets and the chosen area on the real search screen, then opens the real menu', async () => {
  await saveDiscoveryMacroTargets(values, 'search');
  await SecureStore.setItemAsync(MANUAL_LOCATION_KEY, JSON.stringify({ name: 'DTLA', lat: 34.04, lng: -118.24 }));
  const screen = renderJourney('/search?shuffleSeed=maestro-shuffle', {
    ...routes, '(tabs)/search': () => <Search />, 'restaurant/[id]': () => <Restaurant />,
  });
  await waitFor(() => expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(false));
  await press(screen);
  await screen.findByTestId('shuffle-dish');
  expect(Object.fromEntries(requests[0].url.searchParams)).toMatchObject({ ...values, lat: '34.04', lng: '-118.24' });
  expect(screen.getByTestId('discovery-macro-strip')).toBeTruthy();
  await press(screen, 'shuffle-view-menu');
  await screen.findByTestId('menu-item-chicken');
  expect(screen.getPathname()).toBe('/restaurant/seed-bowl');
  expect(screen.getByText('Grilled Chicken Bowl')).toBeTruthy();
});

it('keeps the guided onboarding preview unchanged when Shuffle is enabled', async () => {
  await saveOnboardingField('area', { name: 'DTLA', lat: 34.04, lng: -118.24, source: 'manual' });
  const screen = renderJourney('/welcome/preview', { ...routes, 'welcome/preview': () => <DiscoveryScreen onboardingPreview /> });
  await screen.findByTestId('preview-guide');
  expect(screen.queryByTestId('shuffle-section')).toBeNull();
  expect(requests).toHaveLength(0);
});
