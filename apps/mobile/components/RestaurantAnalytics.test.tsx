import { act, fireEvent, mockState, renderJourney, response, routes, withAccountProfile } from './OnboardingNavigationHarness';
import type { CaptureEvent } from '@posthog/core';
import type { MenuResponse } from '@fitsy/shared';
import Restaurant from '../app/restaurant/[id]';
import { getPostHogClient } from '../lib/analytics';
import { sanitizeAnalyticsEvent } from '../lib/analyticsPrivacy';

const menu: MenuResponse = {
  restaurantId: 'seed-bowl', restaurantName: 'Seed Bowl', locked: false,
  menuItems: [{ id: 'meal', name: 'Chicken Bowl', macros: {
    calories: 520, proteinG: 42, carbsG: 48, fatG: 14,
    confidence: 'HIGH', hadPhoto: false, estimatedAt: '2026-11-05T00:00:00Z',
  } }],
};
let sent: CaptureEvent[];
beforeEach(() => {
  sent = [];
  jest.spyOn(getPostHogClient(), 'capture').mockImplementation((event, properties) => {
    const filtered = sanitizeAnalyticsEvent({ event, properties });
    if (filtered) sent.push(filtered);
  });
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
});

function serve(result: MenuResponse, saveOk = true) {
  global.fetch = jest.fn(withAccountProfile(async (input, init) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/menu')) return response({ data: result });
    if (path === '/api/saved-items') {
      if (init?.method === 'POST') return saveOk ? response({ data: { id: 'saved', menuItemId: 'meal' } })
        : { ...response({ error: 'Unavailable' }), ok: false, status: 503 };
      return response({ data: [] });
    }
    return response({ active: true, verdict: 'active', synced: true, stale: false, lastRcVerifiedAt: new Date().toISOString() });
  }));
}

test.each([true, false])('the real menu journey distinguishes locked=%s without nutrition egress', async locked => {
  serve({ ...menu, locked });
  const screen = renderJourney('/restaurant/seed-bowl', { ...routes, 'restaurant/[id]': () => <Restaurant /> });
  await screen.findByTestId('menu-search');
  await act(async () => { fireEvent.press(screen.getByTestId('menu-item-meal')); });
  expect(sent.find(event => event.event === 'restaurant_detail_viewed')?.properties)
    .toMatchObject({ unlocked: !locked, has_macros: true });
  expect(sent.find(event => event.event === 'menu_item_tapped')?.properties).toMatchObject({ unlocked: !locked });
  expect(JSON.stringify(sent)).not.toMatch(/520|proteinG|estimatedAt|Chicken Bowl/);
});

test.each([true, false])('purchase save continuation reports only confirmed saves: success=%s', async success => {
  serve(menu, success);
  const screen = renderJourney('/restaurant/seed-bowl?selectedItemId=meal&saveSelected=1', {
    ...routes, 'restaurant/[id]': () => <Restaurant />,
  });
  await screen.findByTestId('menu-search');
  expect(sent.filter(event => event.event === 'item_saved')).toHaveLength(success ? 1 : 0);
  if (success) expect(sent.find(event => event.event === 'item_saved')?.properties)
    .toMatchObject({ action: 'save', menu_item_id: 'meal', entry_point: 'purchase_continuation' });
});

test('a menu without macros is not meaningful use and its header never undercounts loaded dishes', async () => {
  serve({ ...menu, totalItemCount: 1, menuItems: [
    { id: 'first', name: 'First meal', macros: null }, { id: 'second', name: 'Second meal', macros: null },
  ] });
  const screen = renderJourney('/restaurant/seed-bowl', { ...routes, 'restaurant/[id]': () => <Restaurant /> });
  await screen.findByTestId('menu-search');
  expect(screen.getByText('2 items')).toBeTruthy();
  expect(sent.find(event => event.event === 'restaurant_detail_viewed')?.properties)
    .toMatchObject({ unlocked: true, has_macros: false, item_count: 2 });
});
