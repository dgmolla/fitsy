import { act, deferred, ExpoLocation, fireEvent, installPurchasedAccount, renderJourney, response, routes, SecureStore, waitFor, withAccountProfile } from './OnboardingNavigationHarness';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Platform } from 'react-native';
import PostHog from 'posthog-react-native';
import type { RestaurantResult } from '@fitsy/shared';
import Search from '../app/(tabs)/search';
import Restaurant from '../app/restaurant/[id]';
import { DiscoveryScreen } from './DiscoveryScreen';
import { saveDiscoveryMacroTargets } from '../lib/macroStorage';
import { FALLBACK_LAT, FALLBACK_LNG, MANUAL_LOCATION_KEY } from '../lib/useLocation';
import { __resetForTesting } from '../lib/analytics';

const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };

const mockAnimate = jest.fn();
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View, Pressable } = require('react-native');
  return { __esModule: true,
    default: React.forwardRef((props: object, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimate }));
      return <View {...props} />;
    }),
    Marker: ({ onPress, ...props }: { onPress: (event: unknown) => void }) =>
      <Pressable testID="native-marker" {...props} onPress={() => onPress({ stopPropagation() {} })} />,
  };
});
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const values = { calories: '600', protein: '40', carbs: '60', fat: '20' };
const restaurants: RestaurantResult[] = ['Flor do Ave', 'Green Kitchen', 'Pizza House', 'Fourth Spot'].map((name, index) => ({
  id: `spot-${index}`, name, address: `${index} Test St`, lat: 34.04 + index * 0.01, lng: -118.24,
  cuisineTags: [index === 0 ? 'Portuguese' : 'Italian'], chainFlag: false, distanceMiles: 1 + index,
  photoUrl: `https://example.test/${index}.jpg`, bestMatch: null,
}));
let requests: URL[];
let rows: RestaurantResult[];
let flag: boolean | string | undefined;
let locked: boolean;
let nextCursor: string | null;
let listeners: Set<() => void>;
let searchResponse: (url: URL) => Promise<Response>;
const originalDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
const originalOS = Platform.OS;
const searchRequests = () => requests.filter(url => url.pathname === '/api/restaurants');
const searchParams = () => Object.fromEntries(searchRequests().at(-1)!.searchParams);

beforeEach(async () => {
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  await installPurchasedAccount();
  await saveDiscoveryMacroTargets(values, 'search');
  await SecureStore.setItemAsync(MANUAL_LOCATION_KEY, JSON.stringify({ name: 'DTLA', lat: 34.04, lng: -118.24 }));
  __resetForTesting();
  mockAnimate.mockClear();
  jest.mocked(ExpoLocation.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
  jest.mocked(ExpoLocation.getLastKnownPositionAsync).mockResolvedValue(null);
  rows = restaurants;
  flag = true;
  locked = false;
  nextCursor = null;
  listeners = new Set();
  jest.mocked(PostHog).mockImplementation(() => ({ capture() {}, identify() {},
    getFeatureFlag: (name: string) => name === 'map-search' ? flag : name === 'shuffle',
    onFeatureFlags: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); },
  }) as unknown as PostHog);
  searchResponse = async () => response({ data: rows, meta: { locked, nextCursor } });
  requests = [];
  global.fetch = jest.fn(withAccountProfile(async input => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === '/api/restaurants') return searchResponse(url);
    if (url.pathname === '/api/restaurants/spot-0/menu') return response({ data: {
      restaurantId: 'spot-0', restaurantName: restaurants[0].name, totalItemCount: 1, locked: false,
      menuItems: [{ id: 'dish-0', name: 'Grilled chicken', category: 'Mains', macros: null }],
    } });
    if (url.pathname === '/api/saved-items') return response({ data: [] });
    return response({ active: true, verdict: 'active', synced: true, stale: false,
      lastRcVerifiedAt: new Date().toISOString(), expiresAt: '2030-01-08T12:00:00Z' });
  }));
});
afterEach(() => {
  if (originalDev) Object.defineProperty(globalThis, '__DEV__', originalDev);
  else Reflect.deleteProperty(globalThis, '__DEV__');
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});
const open = (url = '/search?query=meal') => renderJourney(url, { ...routes, '(tabs)/search': () => <Search /> });

it('opens a photo pin preview, then returns from the real detail using the saved iOS flow control', async () => {
  const screen = renderJourney('/search?query=meal', {
    ...routes, '(tabs)/search': () => <Search />, 'restaurant/[id]': () => <Restaurant />,
  });
  const pin = await screen.findByTestId('map-pin-0');
  expect(pin.props.coordinate).toEqual({ latitude: 34.04, longitude: -118.24 });
  expect(pin.props.stopPropagation).toBe(true);
  expect(pin.props.accessibilityLabel).toBe('Flor do Ave · Portuguese');
  expect(screen.getByLabelText('Photo of Flor do Ave')).toBeTruthy();
  expect(screen.queryByTestId('map-preview')).toBeNull();
  await act(async () => fireEvent.press(pin));
  expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toBe('Open Flor do Ave · Portuguese');
  expect(screen.getPathname()).toBe('/search');
  await act(async () => fireEvent.press(screen.getByTestId('map-preview-open')));
  expect(screen.getPathname()).toBe('/restaurant/spot-0');
  await screen.findByTestId('menu-search');
  type Step = string | { tapOn?: { id: string }; extendedWaitUntil?: { visible: { id: string } } };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/map-search.yaml'), 'utf8')) as [unknown, Step[]];
  const detail = commands.findIndex(step => typeof step === 'object' && step.extendedWaitUntil?.visible.id === 'menu-search');
  expect(detail).toBeGreaterThan(-1);
  const back = commands[detail + 1];
  // Maestro's generic back command does not press an iOS app's custom header.
  if (typeof back !== 'object' || !back.tapOn?.id) throw new Error('The iOS flow must tap the rendered restaurant Back control');
  const backControl = screen.getByTestId(back.tapOn.id);
  await act(async () => fireEvent.press(backControl));
  await screen.findByTestId('discovery-map');
  await screen.findByTestId('map-pin-0');
  expect(screen.getPathname()).toBe('/search');
  expect(screen.getByTestId('discovery-search').props.value).toBe('meal');
  expect(screen.getByText('40g protein')).toBeTruthy();
  expect(screen.getByLabelText('Location: DTLA')).toBeTruthy();
});

it('keeps query, targets and results when switching and applies the same filter editor and shuffle', async () => {
  type Selector = string | { id: string; text: string };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/map-search.yaml'), 'utf8')) as [unknown, { assertVisible?: Selector }[]];
  const proteinAssertions = commands.map(step => step.assertVisible).filter((selector): selector is Selector =>
    typeof selector === 'string' ? selector.endsWith('g protein') : selector?.id === 'map-filter-protein');
  expect(proteinAssertions).toHaveLength(3);
  const screen = open();
  const assertSavedProtein = (checkpoint: number) => {
    const selector = proteinAssertions[checkpoint];
    // iOS exposes the Pressable's explicit label, not the nested visual Text.
    const chip = screen.getByLabelText(typeof selector === 'string' ? selector : selector.text);
    expect(chip.props.accessibilityRole).toBe('button');
    if (typeof selector !== 'string') expect(chip).toBe(screen.getByTestId(selector.id));
  };
  await screen.findByTestId('map-pin-0');
  await act(async () => fireEvent.changeText(screen.getByTestId('discovery-search'), 'pizza'));
  await waitFor(() => expect(searchParams()).toMatchObject({ q: 'pizza' }));
  const before = searchRequests().length;
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByTestId('discovery-hero');
  expect(screen.getByTestId('discovery-search').props.value).toBe('pizza');
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByTestId('map-pin-0');
  expect(searchRequests()).toHaveLength(before);
  assertSavedProtein(0);
  await act(async () => fireEvent.press(screen.getByTestId('preview-edit-targets')));
  await act(async () => fireEvent.changeText(screen.getByLabelText('Protein grams'), '45'));
  await act(async () => fireEvent.press(screen.getByTestId('meal-filter-apply')));
  await screen.findByTestId('map-pin-0');
  assertSavedProtein(1);
  const filtered = Object.fromEntries(searchRequests().at(-1)!.searchParams);
  expect(filtered).toMatchObject({ q: 'pizza', ...values, protein: '45', lat: '34.04', lng: '-118.24' });
  rows = restaurants.map(row => ({ ...row, id: `${row.id}-new`, name: `${row.name} new` }));
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  await waitFor(() => expect(screen.getByTestId('map-pin-0').props.accessibilityLabel).toBe('Flor do Ave new · Portuguese'));
  expect(Object.fromEntries(searchRequests().at(-1)!.searchParams)).toMatchObject({
    ...filtered, shuffle: '1', excludeRestaurantIds: restaurants.map(row => row.id).join(','),
  });
  expect(searchParams().seed).toBeTruthy();
  assertSavedProtein(2);
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByTestId('discovery-hero');
  expect(screen.getByTestId('discovery-search').props.value).toBe('pizza');
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).toBe('Flor do Ave new');
});

it('uses the existing cursor to load more pins and browse previews', async () => {
  rows = restaurants.slice(0, 2);
  nextCursor = 'next-page';
  const screen = open();
  await screen.findByTestId('map-pin-0');
  await act(async () => fireEvent.press(screen.getByLabelText('Next spot')));
  expect(screen.getByText('1 / 2')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByLabelText('Next spot')));
  expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toContain('Green Kitchen');
  rows = restaurants.slice(2);
  nextCursor = null;
  await act(async () => fireEvent.press(screen.getByTestId('map-load-more')));
  await screen.findByTestId('map-pin-3');
  expect(searchParams()).toMatchObject({ cursor: 'next-page' });
  expect(screen.queryByTestId('map-load-more')).toBeNull();
  expect(screen.getByText('2 / 4')).toBeTruthy();
});

it.each(['denied', 'error'])('shows the fallback area and lets a user change it when GPS is %s', async status => {
  await SecureStore.deleteItemAsync(MANUAL_LOCATION_KEY);
  if (status === 'denied') jest.mocked(ExpoLocation.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'denied' } as never);
  else jest.mocked(ExpoLocation.requestForegroundPermissionsAsync).mockRejectedValue(new Error('GPS unavailable'));
  const screen = open();
  await screen.findByTestId('map-location-fallback');
  expect(screen.getByLabelText('Location: Silver Lake, LA')).toBeTruthy();
  expect(Object.fromEntries(searchRequests().at(-1)!.searchParams)).toMatchObject({ lat: String(FALLBACK_LAT), lng: String(FALLBACK_LNG) });
  expect(screen.getByTestId('discovery-map-surface').props.showsUserLocation).toBe(false);
  await act(async () => fireEvent.press(screen.getByTestId('discovery-location')));
  await act(async () => fireEvent.press(screen.getByLabelText('Search near Hollywood')));
  await screen.findByLabelText('Location: Hollywood');
  await screen.findByTestId('map-pin-0');
  expect(screen.queryByTestId('map-location-fallback')).toBeNull();
  expect(Object.fromEntries(searchRequests().at(-1)!.searchParams)).toMatchObject({ lat: '34.0928', lng: '-118.3287' });
});

it('opens around the actual GPS fix when permission is granted', async () => {
  await SecureStore.deleteItemAsync(MANUAL_LOCATION_KEY);
  jest.mocked(ExpoLocation.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
  jest.mocked(ExpoLocation.getLastKnownPositionAsync).mockResolvedValue({ coords: { latitude: 34.08, longitude: -118.27 } } as never);
  const screen = open();
  await screen.findByTestId('map-pin-0');
  expect(screen.getByTestId('discovery-map-surface').props.showsUserLocation).toBe(true);
  expect(mockAnimate).toHaveBeenCalledWith(expect.objectContaining({ latitude: 34.08, longitude: -118.27 }), 350);
  act(() => fireEvent(screen.getByTestId('discovery-map-surface'), 'mapReady'));
  expect(mockAnimate).toHaveBeenCalledWith(expect.objectContaining({ latitude: 34.08, longitude: -118.27 }), 0);
  expect(Object.fromEntries(searchRequests().at(-1)!.searchParams)).toMatchObject({ lat: '34.08', lng: '-118.27' });
});

it('keeps pending, failed, empty and cleared searches recoverable and never shuffles an empty map', async () => {
  const pending = deferred<Response>();
  searchResponse = () => pending.promise;
  const screen = open();
  await screen.findByTestId('discovery-map');
  expect(screen.queryByTestId('map-pin-0')).toBeNull();
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
  await act(async () => pending.resolve({ ok: false, status: 503, json: async () => ({ error: 'offline' }) } as Response));
  await screen.findByTestId('preview-retry');
  rows = [];
  searchResponse = async () => response({ data: rows, meta: { locked: false, nextCursor: null } });
  await act(async () => fireEvent.press(screen.getByTestId('preview-retry')));
  await screen.findByText('No matches for this search');
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
  await act(async () => fireEvent.press(screen.getByTestId('discovery-empty-clear')));
  expect(screen.getByTestId('discovery-search').props.value).toBe('');
  await screen.findByText('No meals with nutrition nearby');
});

it('keeps the same free preview boundary as the list', async () => {
  locked = true;
  const screen = open();
  await screen.findByTestId('map-pin-2');
  expect(screen.queryByTestId('map-pin-3')).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-0')));
  expect(screen.getByTestId('map-preview')).toBeTruthy();
  expect(screen.queryByTestId('map-load-more')).toBeNull();
});

it('offers the list and a real photo placeholder when provider map data is incomplete', async () => {
  rows = [{ ...restaurants[0], photoUrl: undefined }, { ...restaurants[1], lat: NaN }];
  const screen = open();
  await screen.findByTestId('map-pin-0');
  expect(screen.queryByTestId('map-pin-1')).toBeNull();
  expect(screen.getByLabelText('Photo unavailable for Flor do Ave')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByText('Green Kitchen');
});

it('keeps the guided onboarding preview on its existing list even with local opt-in', async () => {
  const screen = renderJourney('/welcome/preview?mapDebug=1', { ...routes, 'welcome/preview': () => <DiscoveryScreen onboardingPreview /> });
  await screen.findByTestId('discovery-search');
  expect(screen.queryByTestId('discovery-map')).toBeNull();
  expect(screen.queryByTestId('discovery-view-toggle')).toBeNull();
});

it.each([undefined, false, 'true', 'control'])('fails closed for a non-boolean map flag (%s)', async value => {
  flag = value;
  const screen = open();
  await screen.findByTestId('discovery-hero');
  expect(screen.queryByTestId('discovery-map')).toBeNull();
  expect(screen.queryByTestId('discovery-view-toggle')).toBeNull();
});

it.each([[false, 'ios'], [true, 'android']])('keeps production and Android on the list, including debug links (dev=%s, os=%s)', async (dev, os) => {
  Object.defineProperty(globalThis, '__DEV__', { value: dev, configurable: true });
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  const screen = open('/search?query=meal&mapDebug=1');
  await screen.findByTestId('discovery-hero');
  expect(screen.queryByTestId('discovery-map')).toBeNull();
});

it('allows explicit local opt-in and removes the map on a remote flag update without losing search', async () => {
  const screen = open();
  await screen.findByTestId('map-pin-0');
  act(() => { flag = false; listeners.forEach(listener => listener()); });
  await screen.findByTestId('discovery-hero');
  expect(screen.getByTestId('discovery-search').props.value).toBe('meal');
  screen.unmount();
  expect(listeners.size).toBe(0);
  const debugScreen = open('/search?query=meal&mapDebug=1');
  await debugScreen.findByTestId('map-pin-0');
});
