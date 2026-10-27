import { act, fireEvent, installPurchasedAccount, renderJourney, response, routes, SecureStore, withAccountProfile } from './OnboardingNavigationHarness';
import React from 'react';
import type { RestaurantResult } from '@fitsy/shared';
import Search from '../app/(tabs)/search';
import { saveDiscoveryMacroTargets } from '../lib/macroStorage';
import { MANUAL_LOCATION_KEY } from '../lib/useLocation';
import { render } from '@testing-library/react-native';
import { RestaurantSection } from './DiscoveryCards';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };
const [, dismissCommands] = loadAll(readFileSync(resolve(__dirname, '../e2e/helpers/dismiss-meal-targets.yaml'), 'utf8')) as [unknown, {
  assertVisible?: { id: string }; tapOn?: { id: string };
  extendedWaitUntil?: { notVisible: { id: string } };
}[]];

// Count work at the native gradient boundary while exercising the real screen,
// hooks, cards and router. No application component or hook is replaced.
const mockCardRenders = jest.fn();
jest.mock('expo-linear-gradient', () => ({ LinearGradient: (props: object) => {
  mockCardRenders();
  return require('react').createElement(require('react-native').View, props);
} }));

const restaurants: RestaurantResult[] = Array.from({ length: 3 }, (_, index) => ({
  id: `perf-${index}`, name: `Kitchen ${index}`, address: 'Fixture', lat: 34.04, lng: -118.24,
  distanceMiles: 1, cuisineTags: [], chainFlag: false, photoUrl: `https://example.test/${index}.jpg`,
  bestMatch: { menuItemId: `meal-${index}`, name: `Meal ${index}`, calories: 600,
    proteinG: 40, carbsG: 60, fatG: 20, confidence: 'HIGH', matchScore: 0 },
}));

beforeEach(async () => {
  await installPurchasedAccount();
  await saveDiscoveryMacroTargets({ calories: '600', protein: '40', carbs: '60', fat: '20' }, 'search');
  await SecureStore.setItemAsync(MANUAL_LOCATION_KEY, JSON.stringify({ name: 'DTLA', lat: 34.04, lng: -118.24 }));
  global.fetch = jest.fn(withAccountProfile(async () => response({ data: restaurants,
    meta: { locked: false, total: restaurants.length, limit: 20, nextCursor: null } })));
});

it('does no additional card work when opening and closing the meal editor', async () => {
  const screen = renderJourney('/search?query=meal', { ...routes, '(tabs)/search': () => <Search /> });
  await screen.findByTestId('discovery-dish-perf-2');
  await act(async () => {});
  mockCardRenders.mockClear();
  await act(async () => fireEvent.press(screen.getByTestId('preview-edit-targets')));
  for (const command of dismissCommands) {
    if (command.assertVisible) expect(screen.getByTestId(command.assertVisible.id)).toBeTruthy();
    if (command.tapOn) {
      await act(async () => fireEvent.press(screen.getByTestId(command.tapOn!.id)));
      await act(async () => { jest.advanceTimersByTime(200); });
    }
    if (command.extendedWaitUntil) expect(screen.queryByTestId(command.extendedWaitUntil.notVisible.id)).toBeNull();
  }
  expect(mockCardRenders).toHaveBeenCalledTimes(0);
  expect(screen.getByTestId('discovery-hero').props.accessibilityLabel).toContain('Kitchen 0');
  await act(async () => fireEvent.press(screen.getByTestId('discovery-dish-perf-2')));
  expect(screen.getPathname()).toBe('/restaurant/perf-2');
});

it('updates memoized rows for new results, rank and entitlement, retaining the current preview callback', () => {
  const onOpen = jest.fn();
  const original = restaurants[1];
  const screen = render(<RestaurantSection result={original} index={0} locked={false} onOpen={onOpen} />);
  expect(screen.getByText('Meal 1')).toBeTruthy();
  const updated = { ...original, name: 'Updated kitchen', bestMatch: { ...original.bestMatch!, name: 'Updated meal' } };
  screen.rerender(<RestaurantSection result={updated} index={1} locked={false} onOpen={onOpen} />);
  expect(screen.getByText('Updated kitchen')).toBeTruthy();
  expect(screen.getByText('Updated meal')).toBeTruthy();
  expect(screen.queryByTestId('preview-pick-2')).toBeNull();
  fireEvent.press(screen.getByTestId('preview-pick-3'));
  expect(onOpen).toHaveBeenLastCalledWith(updated);
  screen.rerender(<RestaurantSection result={{ ...updated, bestMatch: null }} index={1} locked onOpen={onOpen} />);
  expect(screen.queryByText('Updated meal')).toBeNull();
});
