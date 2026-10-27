import { act, deferred, fireEvent, installPurchasedAccount, renderJourney, response, routes, SecureStore, waitFor, withAccountProfile } from './OnboardingNavigationHarness';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StyleSheet } from 'react-native';
import PostHog from 'posthog-react-native';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { within } from '@testing-library/react-native';
import type { RestaurantResult } from '@fitsy/shared';
import Search from '../app/(tabs)/search';
import { saveDiscoveryMacroTargets } from '../lib/macroStorage';
import { MANUAL_LOCATION_KEY } from '../lib/useLocation';
import { __resetForTesting } from '../lib/analytics';
import { DiscoveryScreen } from './DiscoveryScreen';

const values = { calories: '600', protein: '40', carbs: '60', fat: '20' };
const restaurants: RestaurantResult[] = ['Kitchen (DTLA)', 'WILDBIRD', 'Juice House'].map((name, index) => ({
  id: `restaurant-${index}`, name, address: 'Test St', lat: 34.04, lng: -118.24,
  distanceMiles: 1, cuisineTags: [], chainFlag: false,
  bestMatch: { menuItemId: `dish-${index}`, name: `Meal ${index}`, calories: 520,
    proteinG: 42, carbsG: 48, fatG: 14, confidence: 'HIGH', matchScore: 0.9 },
}));
let requests: URL[];
let rows: RestaurantResult[];
let locked: boolean;
let flag: boolean | string | undefined;
let listeners: Set<() => void>;
let searchResponse: () => Promise<Response>;
const originalDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };
const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/shuffle.yaml'), 'utf8')) as [unknown, {
  tapOn?: { id: string }; assertVisible?: { id: string }; assertNotVisible?: { id: string };
  extendedWaitUntil?: { visible: { id: string } }; takeScreenshot?: string;
}[]];

afterEach(() => {
  if (originalDev) Object.defineProperty(globalThis, '__DEV__', originalDev);
  else Reflect.deleteProperty(globalThis, '__DEV__');
});

beforeEach(async () => {
  let seed = 0;
  jest.spyOn(require('expo-crypto') as typeof import('expo-crypto'), 'randomUUID').mockImplementation(() => `shuffle-${++seed}`);
  await installPurchasedAccount();
  await saveDiscoveryMacroTargets(values, 'search');
  await SecureStore.setItemAsync(MANUAL_LOCATION_KEY, JSON.stringify({ name: 'DTLA', lat: 34.04, lng: -118.24 }));
  __resetForTesting();
  rows = restaurants;
  locked = false;
  flag = true;
  listeners = new Set();
  jest.mocked(PostHog).mockImplementation(() => ({ capture() {}, identify() {}, getFeatureFlag: () => flag,
    onFeatureFlags: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); },
  }) as unknown as PostHog);
  searchResponse = async () => response({ data: rows, meta: { locked, total: rows.length, limit: 20, nextCursor: null } });
  requests = [];
  global.fetch = jest.fn(withAccountProfile(async input => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === '/api/restaurants' || url.pathname === '/api/restaurants/guided-preview') return searchResponse();
    return response({ active: !locked, verdict: locked ? 'never_subscribed' : 'active', synced: true, stale: false,
      lastRcVerifiedAt: new Date().toISOString(), expiresAt: '2030-01-08T12:00:00Z' });
  }));
});

it('replaces search cards through the same endpoint with one tiny button and no extra panel', async () => {
  const screen = renderJourney('/search?query=meal', { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('discovery-hero');
  const first = screen.getByTestId('discovery-hero').props.accessibilityLabel;
  const before = requests.filter(url => url.pathname === '/api/restaurants').length;
  rows = restaurants.map(row => ({ ...row, id: row.id + '-fresh', name: row.name + ' fresh' }));
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  expect(requests.filter(url => url.pathname === '/api/restaurants')).toHaveLength(before + 1);
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).not.toBe(first);
  expect(screen.getByTestId('discovery-search').props.value).toBe('meal');
  expect(within(screen.getByTestId('discovery-search-bar')).getByTestId('shuffle-button')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Shuffle results' })).toBeTruthy();
  const button = screen.getByTestId('shuffle-button');
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: 24, height: 24 });
  expect(button.props.hitSlop).toBe(10);
  expect(screen.getAllByTestId('shuffle-button')).toHaveLength(1);
  for (const id of ['shuffle-section', 'shuffle-result', 'shuffle-again', 'shuffle-view-menu', 'shuffle-empty', 'shuffle-error', 'shuffle-loading', 'shuffle-edit-targets']) {
    expect(screen.queryByTestId(id)).toBeNull();
  }
  await waitFor(() => expect(screen.getByTestId('discovery-macro-strip')).toBeTruthy());
  // Replay the saved flow's post-tap assertions against the real search screen.
  const firstTap = commands.findIndex(command => command.tapOn?.id === 'shuffle-button');
  const capture = commands.findIndex(command => command.takeScreenshot === 'shuffle-search');
  expect(firstTap).toBeGreaterThan(0);
  expect(capture).toBeGreaterThan(firstTap);
  for (const command of commands.slice(firstTap + 1, capture)) {
    const visible = command.extendedWaitUntil?.visible ?? command.assertVisible;
    if (visible) expect(screen.getByTestId(visible.id)).toBeTruthy();
    if (command.assertNotVisible) expect(screen.queryByTestId(command.assertNotVisible.id)).toBeNull();
  }
  const shuffledRequest = requests.filter(url => url.pathname === '/api/restaurants').at(-1)!;
  expect(Object.fromEntries(shuffledRequest.searchParams)).toMatchObject({
    shuffle: '1', q: 'meal', ...values, excludeRestaurantIds: restaurants.map(row => row.id).join(','),
  });
  const shuffleParams = Object.fromEntries(shuffledRequest.searchParams);
  expect(shuffleParams.seed).toBeTruthy();
  const second = screen.getByTestId('discovery-hero').props.accessibilityLabel;
  rows = restaurants.map(row => ({ ...row, id: row.id + '-again', name: row.name + ' again' }));
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).not.toBe(second);
  for (const row of rows) expect(screen.getByText(row.name)).toBeTruthy();
  expect(requests.filter(url => url.pathname === '/api/restaurants')).toHaveLength(before + 2);
  const again = requests.filter(url => url.pathname === '/api/restaurants').at(-1)!;
  const againParams = Object.fromEntries(again.searchParams);
  expect(againParams.seed).not.toBe(shuffleParams.seed);
  expect(againParams.excludeRestaurantIds.split(',')).toEqual([
    ...restaurants.map(row => row.id), ...restaurants.map(row => row.id + '-fresh'),
  ]);
  expect(screen.getByRole('button', { name: 'Location: DTLA' })).toBeTruthy();
  expect(requests.some(url => url.pathname.endsWith('/shuffle'))).toBe(false);
  expect(screen.getPathname()).toBe('/search');
  const selected = rows.find(row => screen.getByTestId('discovery-hero').props.accessibilityLabel.startsWith(row.name))!;
  await act(async () => fireEvent.press(screen.getByTestId('discovery-hero')));
  expect(screen.getPathname()).toBe(`/restaurant/${selected.id}`);
});

it('supports a query without macro targets and keeps search and clear usable', async () => {
  await saveDiscoveryMacroTargets({ calories: '', protein: '', carbs: '', fat: '' }, 'search');
  const screen = renderJourney('/search?query=meal', { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('discovery-hero');
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(false);
  const before = requests.length;
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  expect(requests).toHaveLength(before + 1);
  expect(screen.getByTestId('discovery-search').props.value).toBe('meal');
  await act(async () => fireEvent.press(screen.getByTestId('discovery-clear-search')));
  expect(screen.getByTestId('discovery-search').props.value).toBe('');
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
});

it('disables the icon with no results and adds no Shuffle panel', async () => {
  const count = 0;
  rows = restaurants.slice(0, count);
  const screen = renderJourney('/search?query=meal', { ...routes, '(tabs)/search': () => <Search /> });
  if (count) await screen.findByTestId('discovery-hero');
  else await screen.findByText('No matches for this search');
  const before = requests.length;
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  expect(requests).toHaveLength(before);
  expect(screen.queryByTestId('shuffle-section')).toBeNull();
});

it('disables the icon while the search transport is pending', async () => {
  const pending = deferred<Response>();
  searchResponse = () => pending.promise;
  const screen = renderJourney('/search?query=meal', { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('shuffle-button');
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
  await act(async () => pending.resolve(response({ data: restaurants, meta: { locked: false, nextCursor: null } })));
  await waitFor(() => expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(false));
});

it.each([undefined, false, 'control', 'true'])('keeps normal search usable with a disabled rollout flag (%s)', async value => {
  flag = value;
  const screen = renderJourney('/search?query=meal', { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('discovery-hero');
  expect(screen.queryByTestId('shuffle-button')).toBeNull();
  await act(async () => fireEvent.changeText(screen.getByTestId('discovery-search'), 'juice'));
  expect(screen.getByTestId('discovery-search').props.value).toBe('juice');
});

it.each([true, false])('allows the explicit override only in Debug builds (dev=%s)', async dev => {
  Object.defineProperty(globalThis, '__DEV__', { value: dev, configurable: true });
  flag = false;
  const screen = renderJourney('/search?query=meal&shuffleDebug=1', { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('discovery-hero');
  expect(Boolean(screen.queryByTestId('shuffle-button'))).toBe(dev);
});

it.each(['0', 'true', '', '1&shuffleDebug=1'])('rejects a Debug override other than a single 1 (%s)', async value => {
  flag = false;
  const screen = renderJourney(`/search?query=meal&shuffleDebug=${value}`, { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('discovery-hero');
  expect(screen.queryByTestId('shuffle-button')).toBeNull();
});

it('removes the icon on live flag updates without changing the displayed results', async () => {
  const screen = renderJourney('/search?query=meal', { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('discovery-hero');
  const first = screen.getByTestId('discovery-hero').props.accessibilityLabel;
  act(() => { flag = false; listeners.forEach(listener => listener()); });
  expect(screen.queryByTestId('shuffle-button')).toBeNull();
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).toBe(first);
  screen.unmount();
  expect(listeners.size).toBe(0);
});

it('keeps locked results locked and uses the existing subscription entry after fetching another page', async () => {
  locked = true;
  rows = restaurants.map(row => ({ ...row, bestMatch: null }));
  const info = { entitlements: { active: {}, all: {} } } as CustomerInfo;
  jest.mocked(Purchases.logIn).mockResolvedValue({ customerInfo: info, created: false });
  jest.mocked(Purchases.getCustomerInfo).mockResolvedValue(info);
  const screen = renderJourney('/search?query=meal', { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('discovery-hero');
  await screen.findByTestId('search-value-cta');
  const first = screen.getByTestId('discovery-hero').props.accessibilityLabel;
  rows = rows.map(row => ({ ...row, id: row.id + '-locked', name: row.name + ' locked' }));
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).not.toBe(first);
  for (const row of restaurants) expect(screen.queryByText(row.bestMatch!.name)).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('search-value-cta')));
  expect(screen.getPathname()).toBe('/welcome/payment');
});

it('keeps Shuffle out of onboarding preview', async () => {
  const screen = renderJourney('/welcome/preview', { ...routes, 'welcome/preview': () => <DiscoveryScreen onboardingPreview /> });
  await screen.findByTestId('discovery-search');
  expect(screen.queryByTestId('shuffle-button')).toBeNull();
});
