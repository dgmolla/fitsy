import type { MenuResponse } from '@fitsy/shared';
import type { MenuLoadOutcome } from './apiClient';

export function reconcileMenuLoad(previous: MenuResponse | null, restaurantId: string, outcome: MenuLoadOutcome): MenuResponse | null {
  if (outcome.menu) return outcome.menu.restaurantId === restaurantId ? outcome.menu : null;
  // Keep the partial menu through another temporary Retry failure. Explicit
  // access/not-found errors and menus from a different restaurant clear it.
  return outcome.error === 'transient' && previous?.restaurantId === restaurantId && previous.nextCursor ? previous : null;
}
