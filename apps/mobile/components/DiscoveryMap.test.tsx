import { act, deferred, ExpoLocation, fireEvent, installPurchasedAccount, renderJourney, response, routes, SecureStore, waitFor, withAccountProfile } from './OnboardingNavigationHarness';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Platform, StyleSheet } from 'react-native';
import PostHog from 'posthog-react-native';
import type { RestaurantResult } from '@fitsy/shared';
import Search from '../app/(tabs)/search';
import Restaurant from '../app/restaurant/[id]';
import { DiscoveryScreen } from './DiscoveryScreen';
import { saveDiscoveryMacroTargets } from '../lib/macroStorage';
import { FALLBACK_LAT, FALLBACK_LNG, MANUAL_LOCATION_KEY } from '../lib/useLocation';
import { __resetForTesting } from '../lib/analytics';
import { FloatingNavClearanceContext } from '../lib/floatingNav';

const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };

const mockAnimate = jest.fn();
const mockFit = jest.fn();
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View, Pressable } = require('react-native');
  return { __esModule: true,
    default: React.forwardRef((props: object, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimate, animateCamera: jest.fn(), fitToCoordinates: mockFit }));
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
  mockFit.mockClear();
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

it.each([0, 106])('keeps the map tray and camera clear of a %spt floating overlay', async clearance => {
  const Root = routes._layout;
  const screen = renderJourney('/search?query=meal', { ...routes,
    _layout: () => <FloatingNavClearanceContext.Provider value={clearance}><Root /></FloatingNavClearanceContext.Provider>,
    '(tabs)/search': () => <Search />,
  });
  await screen.findByTestId('map-pin-0');
  expect(StyleSheet.flatten(screen.getByTestId('map-tray').props.style).marginBottom).toBe(clearance);
  expect(screen.getByTestId('discovery-map-surface').props.mapPadding).toBeUndefined();
  expect(screen.getByTestId('discovery-map-surface').props.legalLabelInsets.bottom).toBe(220 + clearance + 8);
  expect(screen.queryByTestId('discovery-macro-strip')).toBeNull();
  expect(screen.queryByTestId('preview-edit-targets')).toBeNull();
});

it("opens a compact pin's card, then returns from the real detail using the saved iOS flow control", async () => {
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
  expect(screen.getByLabelText('Search: meal')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  expect(screen.getByText('40g')).toBeTruthy();
  expect(screen.getByLabelText('Location: DTLA')).toBeTruthy();
});

it('opens the real search list and Goals editor while preserving bounded results, targets and shuffle', async () => {
  const screen = open();
  await screen.findByTestId('map-pin-0');
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  expect(screen.queryByTestId('discovery-map')).toBeNull();
  expect(screen.getByTestId('discovery-macro-strip')).toBeTruthy();
  await act(async () => fireEvent.changeText(screen.getByTestId('discovery-search'), 'pizza'));
  await waitFor(() => expect(searchParams().q).toBe('pizza'));
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByTestId('map-card-0');
  const originalCard = screen.getByTestId('map-card-0').props.accessibilityLabel;
  const before = searchRequests().length;
  // Replay the maintained first-result helper through the actual caller.
  type Step = { tapOn?: { id: string }; assertVisible?: { id: string }; assertNotVisible?: { id: string };
    extendedWaitUntil?: { visible: { id: string } } };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/helpers/map-first-spot.yaml'), 'utf8')) as [unknown, Step[]];
  for (const step of commands) {
    if (step.tapOn) await act(async () => fireEvent.press(screen.getByTestId(step.tapOn!.id)));
    else if (step.assertNotVisible) expect(screen.queryByTestId(step.assertNotVisible.id)).toBeNull();
    else if (step.assertVisible) expect(screen.getByTestId(step.assertVisible.id)).toBeTruthy();
    else if (step.extendedWaitUntil) await screen.findByTestId(step.extendedWaitUntil.visible.id);
    else throw new Error('Unexpected saved first-result command');
  }
  expect(screen.getByTestId('map-card-0').props.accessibilityLabel).toBe(originalCard);
  expect(screen.getByLabelText('Search: pizza')).toBeTruthy();
  expect(searchRequests()).toHaveLength(before);
  await act(async () => fireEvent.press(screen.getByTestId('map-options-open')));
  await act(async () => fireEvent.press(screen.getByTestId('map-variant-G')));
  await act(async () => fireEvent.press(screen.getByTestId('map-goals')));
  expect(screen.getByTestId('discovery-map')).toBeTruthy();
  await act(async () => fireEvent.changeText(screen.getByLabelText('Protein grams'), '45'));
  await act(async () => fireEvent.press(screen.getByTestId('meal-filter-apply')));
  await waitFor(() => expect(searchParams()).toMatchObject({ q: 'pizza', protein: '45', lat: '34.04', lng: '-118.24' }));
  searchResponse = async url => {
    const params = Object.fromEntries(url.searchParams);
    return response({ data: params.shuffle && (params.q || params.protein !== '40') ? [] : rows,
      meta: { locked: false, nextCursor: null } });
  };
  await act(async () => fireEvent.press(screen.getByTestId('map-goals')));
  await act(async () => fireEvent.changeText(screen.getByLabelText('Protein grams'), '40'));
  await act(async () => fireEvent.press(screen.getByTestId('meal-filter-apply')));
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  await act(async () => fireEvent.press(screen.getByTestId('discovery-clear-search')));
  await waitFor(() => expect(searchParams().q).toBeUndefined());
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByTestId('map-card-0');
  rows = restaurants.map(row => ({ ...row, id: `${row.id}-new`, name: `${row.name} new` }));
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  await waitFor(() => expect(screen.getByTestId('map-card-0').props.accessibilityLabel).toContain('Flor do Ave new'));
  expect(searchParams()).toMatchObject({ ...values, lat: '34.04', lng: '-118.24', shuffle: '1',
    excludeRestaurantIds: restaurants.map(row => row.id).join(',') });
  expect(searchParams().q).toBeUndefined();
  expect(searchParams().seed).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  expect(screen.getByLabelText('Search restaurants or dishes')).toBeTruthy();
  expect(screen.getByText('40g')).toBeTruthy();
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).toBe('Flor do Ave new');
});

it('keeps a craving and its targets when Shuffle finds no close-fit meals, then recovers through Clear search', async () => {
  await saveDiscoveryMacroTargets({ ...values, protein: '45' }, 'search');
  searchResponse = async url => response({ data: url.searchParams.has('shuffle') ? [] : restaurants,
    meta: { locked: false, nextCursor: null } });
  const screen = open('/search?query=pizza');
  await screen.findByTestId('map-pin-0');
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  await screen.findByText('No matches for this search');
  expect(searchParams()).toMatchObject({ q: 'pizza', ...values, protein: '45', shuffle: '1' });
  expect(screen.getByLabelText('Search: pizza')).toBeTruthy();
  expect(screen.queryByTestId('map-pin-0')).toBeNull();
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
  await act(async () => fireEvent.press(screen.getByTestId('discovery-empty-clear')));
  await screen.findByTestId('map-pin-0');
  expect(searchParams()).toMatchObject({ ...values, protein: '45' });
  expect(searchParams().q).toBeUndefined();
  expect(searchParams().shuffle).toBeUndefined();
  expect(screen.getByLabelText('Search restaurants or dishes')).toBeTruthy();
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(false);
});

it('uses the existing cursor to load more pins and browse previews', async () => {
  rows = restaurants.slice(0, 2);
  nextCursor = 'next-page';
  const screen = open('/search?query=meal&mapTray=A');
  await screen.findByTestId('map-pin-0');
  await act(async () => fireEvent.press(screen.getByLabelText('Next spot')));
  expect(screen.getByText('1 / 2')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByLabelText('Next spot')));
  expect(screen.getByTestId('map-pin-1').props.accessibilityState.selected).toBe(true);
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
  expect(screen.getByTestId('discovery-map-surface').props.initialRegion).toMatchObject({ latitude: 34.08, longitude: -118.27 });
  act(() => fireEvent(screen.getByTestId('discovery-map-surface'), 'mapReady'));
  await waitFor(() => expect(mockFit).toHaveBeenCalled());
  expect(mockAnimate).not.toHaveBeenCalled();
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
  expect(screen.getByLabelText('Search restaurants or dishes')).toBeTruthy();
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
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
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

it('synchronizes carousel cards and settled pins, switches layouts without fetching, and exposes three sheet heights', async () => {
  const screen = open('/search?query=meal&mapDebug=1&mapTray=C');
  await screen.findByTestId('map-pin-0');
  await waitFor(() => expect(screen.getByTestId('map-pin-0').props.tracksViewChanges).toBe(false));
  const before = searchRequests().length;
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-1')));
  expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toContain('Green Kitchen');
  const width = StyleSheet.flatten(screen.getByTestId('map-card-0').props.style).width as number;
  act(() => fireEvent(screen.getByTestId('map-carousel'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 2 * (width + 12), y: 0 } },
  }));
  expect(screen.getByTestId('map-pin-2').props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toContain('Pizza House');
  await waitFor(() => expect(screen.getByTestId('map-pin-2').props.tracksViewChanges).toBe(false));
  await act(async () => fireEvent.press(screen.getByTestId('map-options-open')));
  await act(async () => fireEvent.press(screen.getByTestId('map-variant-A')));
  await screen.findByTestId('map-list-A');
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).toContain('Flor do Ave');
  expect(screen.getByTestId('preview-pick-2')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-1')));
  expect(screen.getByTestId('map-pin-1').props.accessibilityState.selected).toBe(true);
  await act(async () => fireEvent.press(screen.getByTestId('map-options-open')));
  await act(async () => fireEvent.press(screen.getByTestId('map-variant-B')));
  expect(screen.getByTestId('map-sheet-height').props.accessibilityValue.text).toBe('Peek');
  await act(async () => fireEvent.press(screen.getByTestId('map-sheet-height')));
  await screen.findByTestId('map-list-B');
  const half = StyleSheet.flatten(screen.getByTestId('map-tray').props.style).height;
  expect(screen.getByTestId('map-sheet-height').props.accessibilityValue.text).toBe('Half');
  await act(async () => fireEvent.press(screen.getByTestId('map-sheet-height')));
  expect(screen.getByTestId('map-sheet-height').props.accessibilityValue.text).toBe('Full');
  expect(StyleSheet.flatten(screen.getByTestId('map-tray').props.style).height).toBeGreaterThan(half);
  await act(async () => fireEvent.press(screen.getByTestId('map-sheet-height')));
  expect(screen.getByTestId('map-sheet-height').props.accessibilityValue.text).toBe('Peek');
  expect(StyleSheet.flatten(screen.getByTestId('map-tray').props.style).height).toBeLessThan(half);
  act(() => fireEvent(screen.getByTestId('map-sheet-height'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } }));
  expect(screen.getByTestId('map-sheet-height').props.accessibilityValue.text).toBe('Half');
  expect(screen.getByLabelText('Search: meal')).toBeTruthy();
  expect(searchRequests()).toHaveLength(before);
});

it.each(['A', 'B'])('preserves an explicit final pin when layout %s clamps scrolling, but follows a user drag', async variant => {
  const screen = open(`/search?query=meal&mapDebug=1&mapTray=${variant}`);
  await screen.findByTestId('map-pin-3');
  if (variant === 'B') await act(async () => fireEvent.press(screen.getByTestId('map-sheet-height')));
  for (let position = 0; position < restaurants.length; position++) {
    act(() => fireEvent(screen.getByTestId(`preview-pick-${position + 1}`), 'layout', {
      nativeEvent: { layout: { x: 0, y: position * 300, width: 340, height: 300 } },
    }));
  }
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-3')));
  // The native viewport cannot put the final row at its top; animated scrollTo
  // finishes at the content limit, which still exposes part of the previous row.
  act(() => fireEvent(screen.getByTestId(`map-list-${variant}`), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 0, y: 600 } },
  }));
  expect(screen.getByTestId('map-pin-3').props.accessibilityState.selected).toBe(true);
  expect(screen.getByText('4 / 4')).toBeTruthy();
  act(() => fireEvent(screen.getByTestId(`map-list-${variant}`), 'scrollBeginDrag'));
  act(() => fireEvent(screen.getByTestId(`map-list-${variant}`), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 0, y: 300 } },
  }));
  expect(screen.getByTestId('map-pin-1').props.accessibilityState.selected).toBe(true);
  expect(screen.getByText('2 / 4')).toBeTruthy();
});

it('keeps B mounted with its selected final restaurant through Full, Peek and Half', async () => {
  const screen = open('/search?query=meal&mapTray=B');
  await screen.findByTestId('map-pin-3');
  await act(async () => fireEvent.press(screen.getByTestId('map-sheet-height')));
  await act(async () => fireEvent.press(screen.getByTestId('map-sheet-height')));
  const list = screen.getByTestId('map-list-B');
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-3')));
  expect(screen.getByText('4 / 4')).toBeTruthy();
  const [, steps] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/map-search.yaml'), 'utf8')) as [unknown, { evalScript?: string; assertTrue?: string }[]];
  const context = { maestro: { copiedText: screen.getByTestId('preview-pick-4').props.accessibilityLabel }, output: {} as Record<string, string> };
  const nameScript = steps.find(step => step.evalScript?.includes('output.mapLastName ='))!.evalScript!;
  runInNewContext(nameScript.slice(2, -1), context);
  expect(context.output.mapLastName).toBe(restaurants[3].name);
  await act(async () => fireEvent.press(screen.getByTestId('map-sheet-height')));
  context.maestro.copiedText = screen.getByTestId('map-sheet-peek-card').props.accessibilityLabel;
  const peekAssertion = steps.find(step => step.assertTrue?.includes('output.mapLastName'))!.assertTrue!;
  expect(runInNewContext(peekAssertion.slice(2, -1), context)).toBe(true);
  expect(screen.getByTestId('map-list-B', { includeHiddenElements: true })).toBe(list);
  await act(async () => fireEvent.press(screen.getByTestId('map-sheet-height')));
  expect(screen.getByTestId('map-list-B')).toBe(list);
  expect(screen.getByText('4 / 4')).toBeTruthy();
  expect(screen.getByTestId('map-pin-3').props.accessibilityState.selected).toBe(true);
});

it('fits after measured overlays settle without a competing selection camera or a pan fetch', async () => {
  const screen = open();
  await screen.findByTestId('map-pin-0');
  act(() => {
    fireEvent(screen.getByTestId('map-controls'), 'layout', { nativeEvent: { layout: { height: 100 } } });
    fireEvent(screen.getByTestId('map-tray'), 'layout', { nativeEvent: { layout: { height: 226 } } });
    fireEvent(screen.getByTestId('discovery-map-surface'), 'layout', { nativeEvent: { layout: { width: 393, height: 852 } } });
  });
  await waitFor(() => expect(mockFit).toHaveBeenLastCalledWith(
    restaurants.map(result => ({ latitude: result.lat, longitude: result.lng })),
    { edgePadding: { top: 136, bottom: 254, left: 32, right: 32 }, animated: false },
  ));
  const before = searchRequests().length;
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-2')));
  act(() => fireEvent(screen.getByTestId('discovery-map-surface'), 'regionChangeComplete', { latitude: 40, longitude: -74 }));
  expect(mockAnimate).not.toHaveBeenCalled();
  expect(searchRequests()).toHaveLength(before);
});

it('changes existing emoji pin styles without changing results and stops marker tracking after paint', async () => {
  const screen = open('/search?query=meal&mapPin=numbered');
  await screen.findByTestId('map-pin-0');
  const before = searchRequests().length;
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-1')));
  for (const style of ['utensils', 'cuisine']) {
    await act(async () => fireEvent.press(screen.getByTestId('map-options-open')));
    await act(async () => fireEvent.press(screen.getByTestId(`map-pin-style-${style}`)));
    expect(screen.getByTestId('map-pin-1').props.accessibilityState.selected).toBe(true);
    await waitFor(() => expect(screen.getByTestId('map-pin-1').props.tracksViewChanges).toBe(false));
  }
  expect(screen.getAllByText('🍕')).toHaveLength(3);
  expect(screen.getByText('🍴')).toBeTruthy();
  expect(searchRequests()).toHaveLength(before);
});
