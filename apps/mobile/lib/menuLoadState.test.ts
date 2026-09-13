import type { MenuResponse } from '@fitsy/shared';
import { reconcileMenuLoad } from './menuLoadState';

const partial: MenuResponse = { restaurantId: 'r1', restaurantName: 'Test restaurant', menuItems: [{ id: 'meal', name: 'Pasta', macros: null }], totalItemCount: 12, nextCursor: 'next', locked: false };

test('another temporary Retry failure preserves the dishes and retry cursor already shown', () => {
  expect(reconcileMenuLoad(partial, 'r1', { menu: null, error: 'transient' })).toEqual(partial);
});
test('an explicit access failure removes cached unlocked dishes', () => {
  expect(reconcileMenuLoad(partial, 'r1', { menu: null, error: 'unavailable' })).toBeNull();
});
test('a locked response replaces cached unlocked dishes', () => {
  const locked = { ...partial, menuItems: [], locked: true, nextCursor: null };
  expect(reconcileMenuLoad(partial, 'r1', { menu: locked, error: null })).toEqual(locked);
});
test('a successful Retry replaces the partial menu and its retry cursor', () => {
  const complete = { ...partial, totalItemCount: 1, nextCursor: null };
  expect(reconcileMenuLoad(partial, 'r1', { menu: complete, error: null })).toEqual(complete);
});
test('a failed first load never displays another restaurant or invents cached data', () => {
  expect(reconcileMenuLoad(partial, 'r2', { menu: null, error: 'transient' })).toBeNull();
  expect(reconcileMenuLoad(null, 'r1', { menu: null, error: 'transient' })).toBeNull();
});
