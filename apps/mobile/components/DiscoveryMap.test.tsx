import { act, deferred, ExpoLocation, fireEvent, getPaywallIntent, installPurchasedAccount, renderJourney, response, routes, saveOnboardingField, SecureStore, waitFor, withAccountProfile } from './OnboardingNavigationHarness';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Platform, ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { within } from '@testing-library/react-native';
import PostHog from 'posthog-react-native';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import type { RestaurantResult } from '@fitsy/shared';
import Search from '../app/(tabs)/search';
import Restaurant from '../app/restaurant/[id]';
import Preview from '../app/welcome/preview';
import { markPreviewTourSeen } from '../lib/teaserGate';
import { saveDiscoveryMacroTargets } from '../lib/macroStorage';
import { FALLBACK_LAT, FALLBACK_LNG, MANUAL_LOCATION_KEY } from '../lib/useLocation';
import { __resetForTesting } from '../lib/analytics';
import { FloatingNavClearanceContext } from '../lib/floatingNav';
import { EDITORIAL } from '../lib/brand';

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
let shuffleFlag: boolean;
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
  shuffleFlag = true;
  locked = false;
  nextCursor = null;
  listeners = new Set();
  jest.mocked(PostHog).mockImplementation(() => ({ capture() {}, identify() {},
    getFeatureFlag: (name: string) => name === 'map-search' ? flag : name === 'shuffle' && shuffleFlag,
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

it.each(['mapTray=A', 'mapTray=B', 'mapTray=C', 'mapVariant=B'])(
  'ignores retired layout links (%s) and exposes only the chosen carousel, with no pin-style switcher', async retired => {
    const screen = open(`/search?query=meal&mapDebug=1&${retired}`);
    await screen.findByTestId('map-pin-0');
    expect(screen.getByTestId('map-carousel')).toBeTruthy();
    expect(within(screen.getByTestId('map-goals')).getByText('Macros')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Shuffle results' })).toBeTruthy();
    expect(screen.queryByTestId('map-sheet-height')).toBeNull();
    expect(screen.queryByTestId('map-list-A')).toBeNull();
    expect(screen.queryByTestId('map-list-B')).toBeNull();
    expect(screen.queryAllByTestId(/^map-variant-/)).toHaveLength(0);
    expect(screen.queryByTestId('map-options-open')).toBeNull();
  },
);

it('removes the map action surface with Shuffle disabled and keeps the enabled action usable', async () => {
  shuffleFlag = false;
  const screen = open();
  await screen.findByTestId('map-pin-0');
  expect(screen.queryByTestId('shuffle-button')).toBeNull();
  type NativeNode = { props: { style?: StyleProp<ViewStyle> }; children?: (NativeNode | string)[] | null };
  const emptyActionSurfaces = (node: NativeNode | string): number => {
    if (typeof node === 'string') return 0;
    const style = StyleSheet.flatten(node.props.style);
    const emptyAction = !node.children?.length && style?.width === 48 && style?.height === 48;
    return Number(emptyAction) + (node.children ?? []).reduce((count, child) => count + emptyActionSurfaces(child), 0);
  };
  const tree = screen.toJSON();
  expect((Array.isArray(tree) ? tree : tree ? [tree] : []).reduce((count, node) => count + emptyActionSurfaces(node), 0)).toBe(0);
  shuffleFlag = true;
  await act(async () => listeners.forEach(listener => listener()));
  const shuffle = await screen.findByTestId('shuffle-button');
  expect(StyleSheet.flatten(shuffle.props.style)).toMatchObject({ width: 44, height: 44 });
  await act(async () => fireEvent.press(shuffle));
  expect(searchParams().shuffle).toBe('1');
  shuffleFlag = false;
  await act(async () => listeners.forEach(listener => listener()));
  expect(screen.queryByTestId('shuffle-button')).toBeNull();
  expect(screen.getByTestId('map-search-entry')).toBeTruthy();
});

it.each(['map', 'list'])('mapDebug keeps visible Shuffle in the %s controls with the remote flag off', async view => {
  flag = false;
  shuffleFlag = false;
  const screen = open('/search?mapDebug=1&query=meal');
  await screen.findByTestId('map-pin-0');
  if (view === 'list') await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  const shuffle = screen.getByRole('button', { name: 'Shuffle results' });
  const controls = screen.getByTestId(view === 'map' ? 'map-toolbar' : 'discovery-search-bar');
  expect(within(controls).getByTestId('shuffle-button')).toBe(shuffle);
  expect(StyleSheet.flatten(shuffle.props.style)).toMatchObject({ width: 44, height: 44 });
  expect(screen.getAllByTestId('shuffle-button')).toHaveLength(1);
  if (view === 'map') expect(within(controls).getByRole('button', { name: 'Edit macros' })).toBeTruthy();

  const pending = deferred<Response>();
  searchResponse = () => pending.promise;
  await act(async () => fireEvent.press(shuffle));
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
  expect(searchParams()).toMatchObject({ q: 'meal', shuffle: '1', ...values });
  await act(async () => pending.resolve({ ok: false, status: 503, json: async () => ({ error: 'offline' }) } as Response));
  expect(screen.getByTestId('shuffle-button')).toBeTruthy();
  searchResponse = async () => response({ data: rows, meta: { locked: false } });
  await act(async () => fireEvent.press(screen.getByTestId('preview-retry')));
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(false);
  expect(searchParams().q).toBe('meal');
  expect(screen.getByTestId(view === 'map' ? 'map-pin-0' : 'discovery-hero')).toBeTruthy();
});

it.each(['flows/floating-nav', 'helpers/map-search-setup'].flatMap(caller =>
  [false, true].map(enabled => ({ caller, enabled }))))(
  'replays $caller startup with the remote map flag $enabled', async ({ caller, enabled }) => {
    flag = enabled;
    const screen = open();
    await screen.findByTestId(enabled ? 'map-pin-0' : 'discovery-hero');
    type Step = {
      tapOn?: string | { id: string };
      extendedWaitUntil?: { visible: { id: string } };
      runFlow?: { when: { visible: { id: string } }; commands: Step[] };
    };
    const [, commands] = loadAll(readFileSync(resolve(__dirname, `../e2e/${caller}.yaml`), 'utf8')) as [unknown, Step[]];
    const login = commands.findIndex(step => typeof step.tapOn === 'string' && step.tapOn.includes('Dev Login'));
    expect(login).toBeGreaterThan(-1);
    const ready = commands[login + 1]?.extendedWaitUntil;
    if (!ready) throw new Error('The saved startup caller must require discovery readiness after login');
    await screen.findByTestId(ready.visible.id);
    if (caller === 'flows/floating-nav') {
      const branch = commands.slice(login + 2).find(step => step.runFlow?.when.visible.id === 'discovery-map')?.runFlow;
      if (!branch) throw new Error('Floating navigation must handle map-mode startup');
      if (screen.queryByTestId(branch.when.visible.id)) {
        for (const step of branch.commands) {
          if (typeof step.tapOn !== 'object') throw new Error('Map startup must use a rendered named control');
          const target = step.tapOn.id;
          await act(async () => fireEvent.press(screen.getByTestId(target)));
        }
      }
      await screen.findByTestId('discovery-list');
      expect(screen.queryByTestId('discovery-map')).toBeNull();
    }
  },
);

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

it('opens the chosen full-photo card, then returns using the saved iOS flow control', async () => {
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
  const card = screen.getByTestId('map-preview-open');
  expect(card.props.accessibilityLabel).toContain('Flor do Ave');
  expect(StyleSheet.flatten(screen.getByLabelText('Photo of Flor do Ave').props.style)).toMatchObject({ width: '100%', height: '100%' });
  expect(screen.getPathname()).toBe('/search');
  await act(async () => fireEvent.press(card));
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
  expect(screen.getByText('YOUR PICKS NEAR DTLA')).toBeTruthy();
  expect(screen.queryByTestId('discovery-location')).toBeNull();
});

it.each(['LOW', 'MEDIUM'] as const)('keeps actual meal content and %s confidence through the single Map control', async confidence => {
  rows = [{ ...restaurants[0], bestMatch: { menuItemId: 'meal-1', name: 'Grilled salmon plate',
    proteinG: 37, carbsG: 53, fatG: 19, calories: 531, confidence, nutritionBasis: 'estimated', matchScore: 0.2 } }];
  const screen = open();
  await screen.findByTestId('map-card-0');
  expect(screen.getByText('Macros')).toBeTruthy();
  const meal = ['Flor do Ave', 'Grilled salmon plate', 'P 37g', 'C 53g', 'F 19g', '531 kcal', 'Estimated nutrition', `${confidence === 'LOW' ? 'Low' : 'Medium'} confidence`];
  for (const text of meal) expect(within(screen.getByTestId('map-card-0')).getByText(text)).toBeTruthy();
  const qualified = `Estimated nutrition, ${confidence.toLowerCase()} confidence, approximately 531 kcal`;
  expect(screen.getByTestId('map-card-0').props.accessibilityLabel).toContain(qualified);
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  type Step = { tapOn?: string | { id: string }; takeScreenshot?: string };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/map-search.yaml'), 'utf8')) as [unknown, Step[]];
  const start = commands.findIndex(step => step.takeScreenshot === 'map-list-single');
  expect(start).toBeGreaterThan(-1);
  await screen.findByTestId('discovery-list');
  for (const text of meal) expect(within(screen.getByTestId('discovery-hero')).getByText(text)).toBeTruthy();
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).toContain(qualified);
  expect(screen.queryByTestId('discovery-location')).toBeNull();
  const mapControl = commands[start + 1].tapOn;
  if (typeof mapControl !== 'object') throw new Error('The native list journey must use its rendered Map control');
  await act(async () => fireEvent.press(screen.getByTestId(mapControl.id)));
  await act(async () => fireEvent.press(await screen.findByLabelText('Location: DTLA')));
  const area = commands.slice(start).find(step => step.tapOn === 'Search near Hollywood')?.tapOn;
  if (typeof area !== 'string') throw new Error('The native map journey must select a real neighborhood');
  await act(async () => fireEvent.press(await screen.findByLabelText(area)));
  await screen.findByLabelText('Location: Hollywood');
  await waitFor(() => expect(searchParams().lat).not.toBe('34.04'));
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  const input = screen.getByTestId('discovery-search');
  const background = () => StyleSheet.flatten(screen.getByTestId('discovery-search-bar').props.style).backgroundColor;
  const idle = background();
  expect([EDITORIAL.cream, EDITORIAL.creamCard, EDITORIAL.creamDeep]).not.toContain(idle);
  await act(async () => fireEvent(input, 'focus'));
  await act(async () => fireEvent.changeText(input, 'salmon'));
  await waitFor(() => expect(searchParams().q).toBe('salmon'));
  expect(background()).toBe(idle);
  await act(async () => fireEvent(input, 'blur'));
  expect(background()).toBe(idle);
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByTestId('map-pin-0');
  expect(screen.getByLabelText('Location: Hollywood')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-0')));
  for (const text of meal) expect(within(screen.getByTestId('map-preview-open')).getByText(text)).toBeTruthy();
  expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toContain(qualified);
  expect(screen.getByLabelText('Search: salmon')).toBeTruthy();
});

it('searches a settled dragged area only after confirmation and ignores stale area responses', async () => {
  const screen = open('/search?query=salmon');
  const map = await screen.findByTestId('discovery-map-surface');
  await screen.findByTestId('map-pin-0');
  const initialRequests = searchRequests().length;
  const firstArea = { latitude: 34.08, longitude: -118.28, latitudeDelta: 0.06, longitudeDelta: 0.06 };
  await act(async () => fireEvent(map, 'regionChangeComplete', firstArea));
  expect(screen.queryByTestId('map-search-area')).toBeNull();
  // MapKit delivers start/end but no onPanDrag/onTouchMove while scrolling.
  // A tap followed by a programmatic fit must not offer a new area.
  await act(async () => {
    fireEvent(map, 'touchStart', { nativeEvent: { pageX: 200, pageY: 300 } });
    fireEvent(map, 'touchEnd', { nativeEvent: { pageX: 201, pageY: 300 } });
    fireEvent(map, 'regionChangeComplete', firstArea);
  });
  expect(screen.queryByTestId('map-search-area')).toBeNull();
  await act(async () => {
    fireEvent(map, 'touchStart', { nativeEvent: { pageX: 200, pageY: 300 } });
    fireEvent(map, 'touchEnd', { nativeEvent: { pageX: 100, pageY: 300 } });
    fireEvent(map, 'regionChangeComplete', firstArea);
  });
  expect(searchRequests()).toHaveLength(initialRequests);
  expect(screen.getByLabelText('Location: DTLA')).toBeTruthy();
  const oldArea = deferred<Response>();
  searchResponse = url => Object.fromEntries(url.searchParams).lat === '34.08' ? oldArea.promise : Promise.resolve(response({ data: [restaurants[2]], meta: { locked: false, nextCursor: null } }));
  await act(async () => fireEvent.press(screen.getByTestId('map-search-area')));
  await waitFor(() => expect(searchRequests()).toHaveLength(initialRequests + 1));
  expect(searchParams()).toEqual({ lat: '34.08', lng: '-118.28', q: 'salmon', ...values });
  expect(screen.queryByTestId('map-search-area')).toBeNull();
  await act(async () => {
    fireEvent(map, 'touchStart', { nativeEvent: { pageX: 200, pageY: 300 } });
    fireEvent(map, 'touchEnd', { nativeEvent: { pageX: 100, pageY: 300 } });
    fireEvent(map, 'regionChangeComplete', { ...firstArea, latitude: 34.1, longitude: -118.3 });
  });
  expect(searchRequests()).toHaveLength(initialRequests + 1);
  await act(async () => fireEvent.press(screen.getByTestId('map-search-area')));
  await waitFor(() => expect(searchRequests()).toHaveLength(initialRequests + 2));
  expect(searchParams()).toEqual({ lat: '34.1', lng: '-118.3', q: 'salmon', ...values });
  await screen.findByTestId('map-card-0');
  await act(async () => oldArea.resolve(response({ data: [restaurants[0]], meta: { locked: false, nextCursor: null } })));
  expect(within(screen.getByTestId('map-card-0')).getByText('Pizza House')).toBeTruthy();
  expect(screen.queryByText('Flor do Ave')).toBeNull();
  expect(screen.getByLabelText('Location: Map area')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  expect(screen.getByTestId('discovery-search').props.value).toBe('salmon');
  expect(within(screen.getByTestId('discovery-hero')).getByText('Pizza House')).toBeTruthy();
  expect(screen.getByText('40g')).toBeTruthy();
  expect(screen.queryByTestId('discovery-location')).toBeNull();
});

it.each(['published', 'locked', 'missing'])('preserves %s meal disclosure through map and list', async state => {
  locked = state === 'locked';
  rows = [{ ...restaurants[0], bestMatch: state === 'missing' ? null : { menuItemId: 'meal-1', name: 'Published bowl',
    proteinG: 31, carbsG: 47, fatG: 13, calories: 429, confidence: 'HIGH', nutritionBasis: 'published', matchScore: 0.1 } }];
  const screen = open();
  const assertCard = (id: string) => {
    const card = screen.getByTestId(id), content = within(card);
    if (state === 'published') {
      expect(content.getByText('Published nutrition')).toBeTruthy();
      expect(content.getByText('High confidence')).toBeTruthy();
      expect(content.getByText('429 kcal')).toBeTruthy();
      expect(card.props.accessibilityLabel).toContain('Published nutrition, high confidence, 429 kcal');
      expect(card.props.accessibilityLabel).not.toContain('approximately');
    } else {
      expect(content.queryByText('Published bowl')).toBeNull();
      expect(content.queryByText('429 kcal')).toBeNull();
      expect(content.queryByText('Published nutrition')).toBeNull();
      expect(card.props.accessibilityLabel).not.toContain('429');
      expect(card.props.accessibilityLabel).not.toContain('Published bowl');
    }
  };
  await screen.findByTestId('map-card-0'); assertCard('map-card-0');
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  await screen.findByTestId('discovery-hero'); assertCard('discovery-hero');
});

it('opens the real search list and Macros editor while preserving bounded results, targets and shuffle', async () => {
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
  const [, mapFlow] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/map-search.yaml'), 'utf8')) as [unknown, {
    tapOn?: { id: string }; assertVisible?: string | { id: string; text?: string };
  }[]];
  const macroName = mapFlow.find(step => typeof step.assertVisible === 'object' &&
    step.assertVisible.id === 'map-goals' && step.assertVisible.text)?.assertVisible;
  const macroButton = screen.getByTestId('map-goals');
  expect(macroButton.props.accessibilityLabel).toBe(typeof macroName === 'string' ? macroName : macroName?.text);
  expect(within(macroButton).getByText('Macros')).toBeTruthy();
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
  const screen = open();
  await screen.findByTestId('map-pin-0');
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-1')));
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

it('keeps C status actions content-sized and recovers through retry, targets and Clear search', async () => {
  const pending = deferred<Response>();
  searchResponse = () => pending.promise;
  const screen = open();
  await screen.findByTestId('discovery-map');
  expect(screen.queryByTestId('map-pin-0')).toBeNull();
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
  await act(async () => pending.resolve({ ok: false, status: 503, json: async () => ({ error: 'offline' }) } as Response));
  await screen.findByTestId('preview-retry');
  expect(StyleSheet.flatten(screen.getByTestId('map-tray').props.style).height).toBeUndefined();
  rows = [];
  searchResponse = async () => response({ data: rows, meta: { locked: false, nextCursor: null } });
  await act(async () => fireEvent.press(screen.getByTestId('preview-retry')));
  await screen.findByText('No matches for this search');
  expect(StyleSheet.flatten(screen.getByTestId('map-tray').props.style).height).toBeUndefined();
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(true);
  await act(async () => fireEvent.press(screen.getByTestId('discovery-empty-edit')));
  await screen.findByTestId('meal-filter-apply');
  await act(async () => fireEvent.press(screen.getByTestId('meal-filter-apply')));
  rows = restaurants;
  await act(async () => fireEvent.press(screen.getByTestId('discovery-empty-clear')));
  expect(screen.getByLabelText('Search restaurants or dishes')).toBeTruthy();
  await screen.findByTestId('map-pin-0');
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

it('recovers the production map preview, preserves sample disclosure, and carries the selected pick to plans', async () => {
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  flag = false;
  const info = { entitlements: { active: {}, all: {} } } as unknown as CustomerInfo;
  jest.mocked(Purchases.getCustomerInfo).mockResolvedValue(info);
  jest.mocked(Purchases.logIn).mockResolvedValue({ customerInfo: info, created: false });
  await saveOnboardingField('goal', 'lose_fat');
  await saveOnboardingField('area', { lat: 34.04, lng: -118.24, name: 'DTLA', source: 'manual' });
  markPreviewTourSeen();
  rows = restaurants.slice(0, 3).map((row, index) => ({ ...row, bestMatch: {
    menuItemId: `sample-${index}`, name: `Meal ${index}`, calories: index === 1 ? 531 : 600 + index,
    proteinG: 40, carbsG: 60, fatG: 20, confidence: index === 1 ? 'LOW' : 'HIGH', matchScore: index,
    nutritionBasis: index === 1 ? 'estimated' : 'published',
  } }));
  let offline = true;
  global.fetch = jest.fn(withAccountProfile(async input => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === '/api/restaurants/preview') {
      if (offline) throw new TypeError('Offline');
      return response({ data: rows, meta: { nearbyDishCount: 12, radiusMiles: 3 } });
    }
    return response({ active: false, verdict: 'never_subscribed', synced: true, stale: false, lastRcVerifiedAt: new Date().toISOString() });
  }));
  const screen = renderJourney('/welcome/preview', { ...routes, 'welcome/preview': () => <Preview /> });
  await screen.findByTestId('preview-retry');
  expect(screen.getByTestId('discovery-map')).toBeTruthy();
  expect(screen.getByTestId('preview-back')).toBeTruthy();
  // The map preview is the real map screen: no onboarding progress chrome over it.
  expect(screen.queryByLabelText('Onboarding progress')).toBeNull();
  offline = false;
  await act(async () => fireEvent.press(screen.getByTestId('preview-retry')));
  await screen.findByTestId('map-card-2');
  expect(screen.queryByTestId('map-card-3')).toBeNull();
  expect(screen.queryByTestId('map-load-more')).toBeNull();
  expect(screen.queryByTestId('shuffle-button')).toBeNull();
  expect(screen.getByText('Meal 0')).toBeTruthy();
  expect(screen.queryByText('Meal 1')).toBeNull();
  expect(screen.getByTestId('map-card-1').props.accessibilityLabel).not.toContain('Meal 1');
  expect(screen.getByTestId('map-card-1').props.accessibilityLabel).toContain('Estimated nutrition, low confidence');
  expect(screen.getByTestId('map-card-1').props.accessibilityLabel).toContain('approximately 531 kcal');
  expect(screen.getByTestId('map-card-2').props.accessibilityLabel).toContain('Published nutrition, high confidence');
  expect(screen.getByTestId('map-card-2').props.accessibilityLabel).not.toContain('approximately');
  expect(screen.getByTestId('preview-hidden-dish-spot-1', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('locked-value-cta')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  await screen.findByTestId('discovery-list');
  expect(screen.getByTestId('discovery-location')).toBeTruthy();
  expect(screen.getByTestId('preview-pick-2').props.accessibilityLabel).toContain('Estimated nutrition, low confidence, approximately 531 kcal');
  expect(screen.getByTestId('preview-pick-2').props.accessibilityLabel).not.toContain('Meal 1');
  expect(screen.getAllByTestId('discovery-view-toggle')).toHaveLength(1);
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByTestId('map-pin-1');
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-1')));
  await act(async () => fireEvent.press(screen.getByTestId('map-preview-open')));
  await screen.findByText('Payment plans');
  expect(await getPaywallIntent()).toMatchObject({ action: 'menu', restaurantId: 'spot-1', menuItemId: 'sample-1',
    area: { lat: 34.04, lng: -118.24 }, targets: values });
  expect(screen.getPathname()).toBe('/welcome/payment');
  expect(searchRequests()).toHaveLength(0);
  const previewRequests = requests.filter(url => url.pathname === '/api/restaurants/preview');
  expect(previewRequests.length).toBeGreaterThan(0);
  for (const url of previewRequests) {
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ guided: '1', lat: '34.04', lng: '-118.24' });
    expect(url.searchParams.has('cursor')).toBe(false);
  }
});

it('shows a real, named fourth restaurant locked as a paid-tier teaser, with no dish match leaked', async () => {
  await saveOnboardingField('goal', 'lose_fat');
  // A lat/lng unused by any other test in this file - the guided preview
  // client caches by exact area + targets, and the fixed 'buyer' test user
  // id would otherwise collide with another test's cached response.
  await saveOnboardingField('area', { lat: 34.19, lng: -118.39, name: 'Teaser Area', source: 'manual' });
  markPreviewTourSeen();
  const teaser = { ...restaurants[3], bestMatch: null };
  global.fetch = jest.fn(withAccountProfile(async input => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === '/api/restaurants/preview') {
      return response({ data: restaurants.slice(0, 3), meta: { nearbyDishCount: 12, radiusMiles: 3, lockedTeaser: teaser } });
    }
    return response({ active: false, verdict: 'never_subscribed', synced: true, stale: false, lastRcVerifiedAt: new Date().toISOString() });
  }));
  const screen = renderJourney('/welcome/preview', { ...routes, 'welcome/preview': () => <Preview /> });
  await screen.findByTestId('map-card-3');
  expect(screen.getByText('4 / 4')).toBeTruthy();
  expect(screen.getByText('Fourth Spot')).toBeTruthy();
  expect(screen.getByTestId('map-card-3').props.accessibilityLabel).toBe('Fourth Spot. Unlock meal name and full menu with Pro.');
  expect(screen.queryByTestId('preview-hidden-dish-spot-3')).toBeNull();
});

it('shows only the three real picks when the area has no fourth nearby restaurant', async () => {
  await saveOnboardingField('goal', 'lose_fat');
  // Also a cache-key-unique area; see the comment in the preceding test.
  await saveOnboardingField('area', { lat: 34.21, lng: -118.41, name: 'No Teaser Area', source: 'manual' });
  markPreviewTourSeen();
  global.fetch = jest.fn(withAccountProfile(async input => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === '/api/restaurants/preview') {
      return response({ data: restaurants.slice(0, 3), meta: { nearbyDishCount: 3, radiusMiles: 3, lockedTeaser: null } });
    }
    return response({ active: false, verdict: 'never_subscribed', synced: true, stale: false, lastRcVerifiedAt: new Date().toISOString() });
  }));
  const screen = renderJourney('/welcome/preview', { ...routes, 'welcome/preview': () => <Preview /> });
  await screen.findByTestId('map-card-2');
  expect(screen.getByText('3 / 3')).toBeTruthy();
  expect(screen.queryByTestId('map-card-3')).toBeNull();
});

it.each([undefined, false, 'true', 'control'])('fails closed for a non-boolean map flag (%s)', async value => {
  flag = value;
  const screen = open();
  await screen.findByTestId('discovery-hero');
  expect(screen.queryByTestId('discovery-map')).toBeNull();
  expect(screen.queryByTestId('discovery-view-toggle')).toBeNull();
});

it.each(['', '&mapDebug=1&shuffleDebug=1'])('opens production iOS on the map with Shuffle and list access without remote opt-ins (%s)', async link => {
  flag = false;
  shuffleFlag = false;
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  const screen = open(`/search?query=meal${link}`);
  await screen.findByTestId('map-pin-0');
  expect(screen.queryByTestId('discovery-list')).toBeNull();
  expect(screen.getByTestId('shuffle-button').props.accessibilityState.disabled).toBe(false);
  expect(screen.getByLabelText('Search: meal')).toBeTruthy();
  expect(within(screen.getByTestId('map-goals')).getByText('Macros')).toBeTruthy();
  const beforeShuffle = searchRequests().length;
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  await waitFor(() => expect(searchRequests().length).toBeGreaterThan(beforeShuffle));
  expect(searchParams()).toMatchObject({ q: 'meal', shuffle: '1', ...values });
  await screen.findByTestId('map-pin-0');
  await act(async () => fireEvent.press(screen.getByTestId('map-search-entry')));
  expect(screen.getByTestId('discovery-search').props.value).toBe('meal');
  expect(screen.getByTestId('shuffle-button')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('discovery-view-toggle')));
  await screen.findByTestId('map-pin-0');
});

it.each([false, true])('keeps Android on the list, including debug links (dev=%s)', async dev => {
  shuffleFlag = false;
  Object.defineProperty(globalThis, '__DEV__', { value: dev, configurable: true });
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  const screen = open('/search?query=meal&mapDebug=1');
  await screen.findByTestId('discovery-hero');
  expect(screen.queryByTestId('discovery-map')).toBeNull();
  expect(Boolean(screen.queryByTestId('shuffle-button'))).toBe(dev);
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

it('synchronizes the chosen carousel cards and settled pins without fetching', async () => {
  const screen = open('/search?query=meal&mapDebug=1');
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
  expect(screen.getByLabelText('Search: meal')).toBeTruthy();
  expect(searchRequests()).toHaveLength(before);
});

it.each(['pin', 'drag'])(
  'restores C after %s selection, failed Shuffle and unchanged retry rows', async selection => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const screen = open();
  await screen.findByTestId('map-pin-2');
  const previousCarousel = screen.getByTestId('map-carousel');
  const stride = (StyleSheet.flatten(screen.getByTestId('map-card-0').props.style).width as number) + 12;
  if (selection === 'pin') {
    await act(async () => fireEvent.press(screen.getByTestId('map-pin-2')));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 2 * stride, animated: true });
  } else {
    act(() => fireEvent(previousCarousel, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 2 * stride, y: 0 } } }));
    expect(screen.getByTestId('map-pin-2').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toContain('Pizza House');
  }
  const failedShuffle = deferred<Response>();
  searchResponse = () => failedShuffle.promise;
  await act(async () => fireEvent.press(screen.getByTestId('shuffle-button')));
  expect(screen.queryByTestId('map-carousel')).toBeNull();
  await act(async () => failedShuffle.resolve({ ok: false, status: 503, json: async () => ({ error: 'offline' }) } as Response));
  await screen.findByTestId('preview-retry');
  expect(screen.getByTestId('map-pin-2').props.accessibilityState.selected).toBe(true);
  searchResponse = async () => response({ data: rows, meta: { locked: false, nextCursor: null } });
  scrollTo.mockClear();
  await act(async () => fireEvent.press(screen.getByTestId('preview-retry')));
  const restoredCarousel = await screen.findByTestId('map-carousel');
  expect(restoredCarousel).not.toBe(previousCarousel);
  act(() => fireEvent(restoredCarousel, 'layout', { nativeEvent: { layout: { width: stride, height: 210 } } }));
  expect(scrollTo).toHaveBeenLastCalledWith({ x: 2 * stride, animated: false });
  scrollTo.mockClear();
  act(() => fireEvent(restoredCarousel, 'contentSizeChange', rows.length * stride, 210));
  expect(scrollTo).toHaveBeenLastCalledWith({ x: 2 * stride, animated: false });
  expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toContain('Pizza House');
  expect(screen.getByTestId('map-pin-2').props.accessibilityState.selected).toBe(true);
  expect(within(screen.getByTestId('map-preview')).getByText('3 / 4')).toBeTruthy();
  act(() => fireEvent(restoredCarousel, 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: stride, y: 0 } },
  }));
  expect(screen.getByTestId('map-pin-1').props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toContain('Green Kitchen');
  expect(within(screen.getByTestId('map-preview')).getByText('2 / 4')).toBeTruthy();
  act(() => fireEvent(restoredCarousel, 'contentSizeChange', rows.length * stride, 210));
  expect(scrollTo).toHaveBeenLastCalledWith({ x: stride, animated: false });
});

it('keeps the final C card, pin and native literal name/count proof synchronized after a real drag', async () => {
  const screen = open();
  await screen.findByTestId('map-pin-3');
  const stride = (StyleSheet.flatten(screen.getByTestId('map-card-0').props.style).width as number) + 12;
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-3')));
  act(() => fireEvent(screen.getByTestId('map-carousel'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 3 * stride, y: 0 } },
  }));
  const [, steps] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/map-search.yaml'), 'utf8')) as [unknown, { evalScript?: string; assertTrue?: string }[]];
  const context = { maestro: { copiedText: '4 / 4' }, output: {} as Record<string, string | number> };
  const evaluate = (source: string) => runInNewContext(source.slice(2, -1), context);
  evaluate(steps.find(step => step.evalScript?.includes('output.mapCount ='))!.evalScript!);
  expect(context.output.mapCount).toBe(restaurants.length);
  context.maestro.copiedText = screen.getByTestId('map-preview-open').props.accessibilityLabel;
  evaluate(steps.find(step => step.evalScript?.includes('output.mapLastName ='))!.evalScript!);
  expect(context.output.mapLastName).toBe(restaurants[3].name);
  context.maestro.copiedText = screen.getByTestId('map-pin-3').props.accessibilityLabel;
  expect(evaluate(steps.find(step => step.assertTrue?.includes('output.mapLastName'))!.assertTrue!)).toBe(true);
  expect(screen.getByTestId('map-pin-3').props.accessibilityState.selected).toBe(true);
  expect(within(screen.getByTestId('map-preview')).getByText('4 / 4')).toBeTruthy();
  act(() => fireEvent(screen.getByTestId('map-carousel'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 2 * stride, y: 0 } },
  }));
  expect(screen.getByTestId('map-preview-open').props.accessibilityLabel).toContain('Pizza House');
  expect(screen.getByTestId('map-pin-2').props.accessibilityState.selected).toBe(true);
  expect(within(screen.getByTestId('map-preview')).getByText('3 / 4')).toBeTruthy();
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
  // A native touch can end without MapKit moving or completing a region.
  // That incomplete gesture must not suppress a later measured camera fit.
  const map = screen.getByTestId('discovery-map-surface');
  act(() => {
    fireEvent(map, 'touchStart', { nativeEvent: { pageX: 200, pageY: 300 } });
    fireEvent(map, 'touchEnd', { nativeEvent: { pageX: 100, pageY: 300 } });
    fireEvent(screen.getByTestId('map-controls'), 'layout', { nativeEvent: { layout: { height: 120 } } });
  });
  await waitFor(() => expect(mockFit).toHaveBeenLastCalledWith(
    restaurants.map(result => ({ latitude: result.lat, longitude: result.lng })),
    { edgePadding: { top: 156, bottom: 254, left: 32, right: 32 }, animated: false },
  ));
  act(() => fireEvent(map, 'regionChangeComplete', { latitude: 34.04, longitude: -118.24 }));
  expect(screen.queryByTestId('map-search-area')).toBeNull();
  expect(searchRequests()).toHaveLength(before);
});

it('selects a pin without changing results and stops marker tracking after paint', async () => {
  const screen = open('/search?query=meal');
  await screen.findByTestId('map-pin-0');
  const before = searchRequests().length;
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-1')));
  expect(screen.getByTestId('map-pin-1').props.accessibilityState.selected).toBe(true);
  await waitFor(() => expect(screen.getByTestId('map-pin-1').props.tracksViewChanges).toBe(false));
  expect(searchRequests()).toHaveLength(before);
});

it('does not re-arm a deselected pin\'s native tracking, bounding concurrent snapshots under rapid taps', async () => {
  // A deselected pin reverts to its already-rendered unselected look - no
  // re-render to capture, so it must drop tracking immediately rather than
  // riding out another 250ms window. Letting every pin a rapid tap-storm
  // touches keep tracking live for its own window left an unbounded,
  // growing set of markers mid-snapshot at once - a real react-native-maps
  // stability hazard this guards against.
  const screen = open('/search?query=meal');
  await screen.findByTestId('map-pin-0');
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-1')));
  await waitFor(() => expect(screen.getByTestId('map-pin-1').props.tracksViewChanges).toBe(false));
  await act(async () => fireEvent.press(screen.getByTestId('map-pin-2')));
  expect(screen.getByTestId('map-pin-1').props.accessibilityState.selected).toBe(false);
  expect(screen.getByTestId('map-pin-1').props.tracksViewChanges).toBe(false);
  expect(screen.getByTestId('map-pin-2').props.tracksViewChanges).toBe(true);
  await waitFor(() => expect(screen.getByTestId('map-pin-2').props.tracksViewChanges).toBe(false));
});
