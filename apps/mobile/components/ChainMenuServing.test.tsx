import { act, fireEvent, getPaywallIntent, mockState, renderJourney, response, routes, waitFor, withAccountProfile } from './OnboardingNavigationHarness';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MenuResponse } from '@fitsy/shared';
import Restaurant from '../app/restaurant/[id]';
import Payment from '../app/welcome/payment';
import Purchases from 'react-native-purchases';

const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };

type Selector = string | { id: string; text?: string };
type Step = {
  tapOn?: string | { id?: string };
  assertVisible?: Selector;
  assertNotVisible?: Selector;
  extendedWaitUntil?: { visible: Selector };
};
const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/chain-menu-serving.yaml'), 'utf8')) as [unknown, Step[]];
const menu: MenuResponse = {
  restaurantId: 'seed-bowl', restaurantName: 'Seed Bowl Co #01', totalItemCount: 8, locked: true,
  menuItems: ['Grilled Chicken Bowl', 'Salmon Bowl', 'Tofu Bowl'].map((name, index) => ({
    id: `seed-${index}`, name, category: 'Bowls',
    macros: { calories: 520, proteinG: 42, carbsG: 48, fatG: 14, confidence: 'HIGH', hadPhoto: false, estimatedAt: '2026-10-24T00:00:00Z' },
  })),
};

it('the signed-in free chain journey reaches subscription plans with its selected restaurant', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  const packageOffer = { identifier: '$rc_annual', product: { identifier: 'annual', price: 59.99, priceString: '$59.99', currencyCode: 'USD', subscriptionPeriod: 'P1Y', introPrice: null } };
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: { identifier: 'default', annual: packageOffer, monthly: null, availablePackages: [packageOffer], metadata: {} }, all: {} } as never);
  // Only HTTP and native boundaries are synthetic; filtering, intent storage,
  // routing and both screens use the application code.
  global.fetch = jest.fn(withAccountProfile(async (input: RequestInfo | URL) => {
    if (new URL(String(input)).pathname === '/api/restaurants/seed-bowl/menu') return response({ data: menu });
    return response({ active: false, verdict: 'never_subscribed', synced: true, stale: false, lastRcVerifiedAt: new Date().toISOString() });
  }));
  const screen = renderJourney('/restaurant/seed-bowl', { ...routes, 'restaurant/[id]': () => <Restaurant />, 'welcome/payment': () => <Payment /> });
  await screen.findByTestId('menu-search');
  expect(screen.getByText('8 items')).toBeTruthy();
  expect(screen.getAllByLabelText('dish name hidden, view plans to find this meal')).toHaveLength(3);
  await act(async () => { fireEvent.changeText(screen.getByTestId('menu-search'), 'fitsy-no-such-dish'); });
  expect(screen.getByText('No dishes match these filters.')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('menu-search-clear')); });
  expect(screen.queryByText('No dishes match these filters.')).toBeNull();
  await act(async () => { fireEvent.changeText(screen.getByTestId('menu-search'), 'Grilled Chicken Bowl'); });
  expect(screen.getByText('1 dish matches')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('menu-search-clear')); });
  expect(screen.getByText('3 dishes match')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('menu-item-seed-0')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  await screen.findByTestId('paywall-logo');
  expect(await getPaywallIntent()).toMatchObject({
    action: 'menu', restaurantId: menu.restaurantId, restaurantName: menu.restaurantName, menuItemId: 'seed-0',
  });
  expect(mockState.session?.user.id).toBe('buyer');
  expect(screen.queryByTestId('signup-apple')).toBeNull();

  // Exercise the YAML's actual final selectors against the real destination.
  // This catches stale generic signup copy even while navigation still works.
  const tap = commands.findIndex(step => typeof step.tapOn === 'object' && step.tapOn.id?.includes('output.chicken.id'));
  expect(tap).toBeGreaterThan(-1);
  for (const step of commands.slice(tap + 1)) {
    const selector = step.assertVisible ?? step.extendedWaitUntil?.visible;
    if (selector) await waitFor(() => {
      const element = typeof selector === 'string' ? screen.getByText(new RegExp(selector)) : screen.getByTestId(selector.id);
      expect(element).toBeTruthy();
      if (typeof selector === 'object' && selector.text) expect(element.props.children).toBe(selector.text);
    });
    const absent = step.assertNotVisible;
    if (absent) expect(typeof absent === 'string' ? screen.queryByText(new RegExp(absent)) : screen.queryByTestId(absent.id)).toBeNull();
  }
});
