import { act, fireEvent, installPurchasedAccount, renderJourney, response, router, routes, withAccountProfile } from './OnboardingNavigationHarness';
import React, { useEffect } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StyleSheet, Text } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useNavigation } from 'expo-router';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import PostHog from 'posthog-react-native';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import type { SavedItemResponse } from '@fitsy/shared';
import TabLayout from '../app/(tabs)/_layout';
import Search from '../app/(tabs)/search';
import Saved from '../app/(tabs)/saved';
import Profile from '../app/(tabs)/profile';
import { useFloatingNavFlag } from '../lib/useFloatingNavFlag';
import { __resetForTesting } from '../lib/analytics';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

let flag: boolean | string | undefined;
let flagError: boolean;
let listeners: Set<() => void>;
const capture = jest.fn();
const originalDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
const savedItem: SavedItemResponse = {
  id: 'saved-meal', menuItemId: 'bowl', restaurantId: 'kitchen', itemType: 'menu_item', createdAt: '2026-01-01T12:00:00Z',
  menuItem: { id: 'bowl', name: 'Rice bowl', macros: null, restaurant: { id: 'kitchen', name: 'Kitchen', address: 'Test St' } },
};

beforeEach(async () => {
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  await installPurchasedAccount();
  __resetForTesting();
  flag = true;
  flagError = false;
  listeners = new Set();
  capture.mockClear();
  jest.mocked(PostHog).mockImplementation(() => ({ capture, identify() {},
    getFeatureFlag: (name: string) => {
      if (flagError) throw new Error('Flag unavailable');
      return name === 'floating-nav' ? flag : false;
    },
    onFeatureFlags: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); },
  }) as unknown as PostHog);
  jest.spyOn(Haptics, 'selectionAsync').mockResolvedValue(undefined);
  global.fetch = jest.fn(withAccountProfile(async input => {
    const path = new URL(input).pathname;
    if (path === '/api/saved-items') return response({ data: [savedItem] });
    if (path === '/api/restaurants') return response({ data: [], meta: { locked: false, nextCursor: null } });
    return response({ active: true, verdict: 'active', synced: true, stale: false,
      lastRcVerifiedAt: new Date().toISOString(), expiresAt: '2030-01-08T12:00:00Z' });
  }));
});
afterEach(() => {
  if (originalDev) Object.defineProperty(globalThis, '__DEV__', originalDev);
  else Reflect.deleteProperty(globalThis, '__DEV__');
});

function open(url = '/search', bottom = 34, search = () => <Search />) {
  const Root = routes._layout;
  const routeMap = {
    ...routes,
    _layout: () => <SafeAreaInsetsContext.Provider value={{ top: 59, bottom, left: 0, right: 0 }}><Root /></SafeAreaInsetsContext.Provider>,
    '(tabs)/_layout': () => <TabLayout />, '(tabs)/search': search, '(tabs)/saved': Saved, '(tabs)/profile': Profile,
  };
  return renderJourney(url, routeMap);
}

it.each([undefined, false, 'true', 'control'])('keeps the current bar and original content spacing when the flag is %s', async value => {
  flag = value;
  const screen = open();
  await screen.findByTestId('discovery-list');
  expect(screen.queryByTestId('floating-tab-bar')).toBeNull();
  expect(screen.getByText('SAVED')).toBeTruthy();
  expect(screen.getByText('PROFILE')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('discovery-list').props.contentContainerStyle).paddingBottom).toBe(28);
  await act(async () => fireEvent.press(screen.getByTestId('tab-saved')));
  await screen.findByText('Rice bowl');
  expect(StyleSheet.flatten(screen.getByTestId('saved-content').props.contentContainerStyle).paddingBottom).toBe(32);
  await act(async () => fireEvent.press(screen.getByTestId('tab-profile')));
  await screen.findByTestId('profile-scroll');
  expect(StyleSheet.flatten(screen.getByTestId('profile-scroll').props.contentContainerStyle).paddingBottom).toBe(100);
});

it.each([0, 21, 34])('keeps every tab reachable and its last content above the capsule with a %spt safe area', async bottom => {
  const screen = open('/search', bottom);
  await screen.findByTestId('discovery-list');
  expect(screen.getByRole('tab', { name: 'Search', selected: true })).toBeTruthy();
  expect(screen.queryByText('SAVED')).toBeNull();
  expect(screen.queryByText('PROFILE')).toBeNull();
  const clearance = 64 + 8 + bottom;
  expect(StyleSheet.flatten(screen.getByTestId('discovery-list').props.contentContainerStyle).paddingBottom).toBe(clearance + 28);
  // The full-width positioning layer passes touches through outside the capsule.
  const position = screen.getByTestId('floating-tab-bar-position');
  expect(position.props.pointerEvents).toBe('box-none');
  expect(StyleSheet.flatten(position.props.style).bottom).toBe(bottom + 8);
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Saved' })));
  await screen.findByText('Rice bowl');
  expect(screen.getPathname()).toBe('/saved');
  expect(screen.getByRole('tab', { name: 'Saved', selected: true })).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('saved-content').props.contentContainerStyle).paddingBottom).toBe(clearance + 32);
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Profile' })));
  await screen.findByTestId('profile-scroll');
  expect(screen.getPathname()).toBe('/profile');
  expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('profile-scroll').props.contentContainerStyle).paddingBottom).toBe(Math.max(100, clearance + 24));
  expect(screen.getByTestId('profile-terms')).toBeTruthy();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
  expect(capture.mock.calls.filter(([event]) => event === 'tab_switched')).toEqual([
    ['tab_switched', { tab: 'saved', from_tab: null }],
    ['tab_switched', { tab: 'profile', from_tab: 'saved' }],
  ]);
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Profile' })));
  expect(capture.mock.calls.filter(([event]) => event === 'tab_switched')).toHaveLength(2);
  expect(screen.getPathname()).toBe('/profile');
});

it('switches the bar and clearance together when remote flags arrive or are disabled', async () => {
  flag = undefined;
  const screen = open();
  await screen.findByTestId('discovery-list');
  expect(screen.queryByTestId('floating-tab-bar')).toBeNull();
  await act(async () => { flag = true; listeners.forEach(update => update()); });
  expect(screen.getByTestId('floating-tab-bar')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('discovery-list').props.contentContainerStyle).paddingBottom).toBe(134);
  await act(async () => { flag = false; listeners.forEach(update => update()); });
  expect(screen.queryByTestId('floating-tab-bar')).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId('discovery-list').props.contentContainerStyle).paddingBottom).toBe(28);
  expect(screen.getPathname()).toBe('/search');
});

it('fails closed on flag errors and removes the SDK listener on unmount', () => {
  flagError = true;
  const { result, unmount } = renderHook(() => useFloatingNavFlag());
  expect(result.current).toBe(false);
  act(() => { flagError = false; listeners.forEach(update => update()); });
  expect(result.current).toBe(true);
  act(() => { flagError = true; listeners.forEach(update => update()); });
  expect(result.current).toBe(false);
  unmount();
  expect(listeners.size).toBe(0);
});

it('fails closed when the SDK cannot initialize', () => {
  jest.mocked(PostHog).mockImplementation(() => { throw new Error('SDK unavailable'); });
  const { result } = renderHook(() => useFloatingNavFlag());
  expect(result.current).toBe(false);
});

it.each(['0', '1'])('ignores the local capture parameter in release mode (%s)', value => {
  flag = value === '0';
  const { result } = renderHook(() => useFloatingNavFlag(value));
  expect(result.current).toBe(flag);
});

it.each(['true', '', 'false', '01'])('rejects an invalid Debug capture parameter (%s)', value => {
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  flag = false;
  const { result } = renderHook(() => useFloatingNavFlag(value));
  expect(result.current).toBe(false);
});

it('keeps the Debug opt-in across tab switches and allows an explicit off capture', async () => {
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  flag = false;
  const screen = open('/search?floatingNavDebug=1');
  await screen.findByTestId('floating-tab-bar');
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Profile' })));
  await screen.findByTestId('profile-scroll');
  expect(screen.getByTestId('floating-tab-bar')).toBeTruthy();
  screen.unmount();
  flag = true;
  const off = open('/search?floatingNavDebug=0');
  await off.findByTestId('discovery-list');
  expect(off.queryByTestId('floating-tab-bar')).toBeNull();
});

it('honors a prevented tab press and still supports tab long presses', async () => {
  const longPress = jest.fn();
  function PreventSearch() {
    const navigation = useNavigation<BottomTabNavigationProp<{ search: undefined; saved: undefined }>>();
    useEffect(() => navigation.addListener('tabPress', event => event.preventDefault()), [navigation]);
    useEffect(() => navigation.addListener('tabLongPress', longPress), [navigation]);
    return <Text>Search results</Text>;
  }
  const screen = open('/search', 34, PreventSearch);
  await screen.findByTestId('floating-tab-bar');
  await act(async () => fireEvent(screen.getByRole('tab', { name: 'Search' }), 'longPress'));
  expect(longPress).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Saved' })));
  await screen.findByText('Rice bowl');
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Search' })));
  expect(screen.getPathname()).toBe('/saved');
});

it('navigates even when the native haptics service rejects the request', async () => {
  jest.mocked(Haptics.selectionAsync).mockRejectedValue(new Error('Haptics unavailable'));
  const screen = open();
  await screen.findByTestId('floating-tab-bar');
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Saved' })));
  await screen.findByText('Rice bowl');
  expect(screen.getPathname()).toBe('/saved');
});

it('retains entitled navigation for a sandbox entitlement in production mode', async () => {
  const pro = { isActive: true, isSandbox: true, periodType: 'NORMAL', willRenew: true };
  const customerInfo = { entitlements: { active: { pro }, all: { pro } } } as unknown as CustomerInfo;
  jest.mocked(Purchases.getCustomerInfo).mockResolvedValue(customerInfo);
  jest.mocked(Purchases.logIn).mockResolvedValue({ customerInfo, created: false });
  const screen = open();
  await screen.findByTestId('floating-tab-bar');
  expect(screen.getPathname()).toBe('/search');
  expect(screen.queryByText('Payment plans')).toBeNull();
});

it('replays the saved capture flow through the actual tab navigator', async () => {
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  flag = false;
  type Target = string | { id: string };
  type Step = { openLink?: string; tapOn?: { id?: string; optional?: boolean }; assertVisible?: Target;
    assertNotVisible?: Target; extendedWaitUntil?: { visible: Target }; takeScreenshot?: string;
    scrollUntilVisible?: { element: Target } };
  const yaml = require('js-yaml') as { loadAll(source: string): unknown[] };
  const [config, steps] = yaml.loadAll(readFileSync(resolve(__dirname, '../e2e/flows/floating-nav.yaml'), 'utf8')) as [
    { appId: string; tags: string[] }, Step[],
  ];
  expect(config.appId).toBe('com.fitsy.mobile');
  expect(config.tags).toContain('fixture:entitled-dev');
  const start = steps.findIndex(step => step.openLink?.endsWith('floatingNavDebug=0'));
  expect(start).toBeGreaterThan(0);
  const screen = open('/search?floatingNavDebug=0');
  const find = (target: Target) => typeof target === 'string' ? screen.queryByText(target) : screen.queryByTestId(target.id);
  const captures: string[] = [];
  const checkpoints: string[] = [];
  for (const step of steps.slice(start)) {
    if (step.openLink) {
      const url = step.openLink.replace('com.fitsy.mobile://', '/');
      await act(async () => router.navigate(url as '/search'));
    }
    if (step.tapOn?.id) await act(async () => fireEvent.press(screen.getByTestId(step.tapOn!.id!)));
    const visible = step.extendedWaitUntil?.visible ?? step.assertVisible ?? step.scrollUntilVisible?.element;
    checkpoints.push(JSON.stringify({ step, url: screen.getPathnameWithParams() }));
    if (visible) {
      try {
        if (typeof visible === 'string') await screen.findByText(visible);
        else await screen.findByTestId(visible.id);
      } catch (error) {
        throw new Error(checkpoints.join('\n') + '\n' + JSON.stringify(screen.getRouterState()), { cause: error });
      }
    }
    if (step.assertNotVisible) expect(find(step.assertNotVisible)).toBeNull();
    if (step.takeScreenshot) captures.push(step.takeScreenshot);
  }
  expect(captures).toEqual(['floating-nav-off-search', 'floating-nav-on-search', 'floating-nav-on-saved', 'floating-nav-on-profile']);
  expect(screen.getPathname()).toBe('/search');
  expect(screen.getByRole('tab', { name: 'Search', selected: true })).toBeTruthy();
});
