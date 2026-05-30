import type { PreviewRestaurant } from './previewSearch';

/**
 * Shared cache so the finding screen can pre-fetch for the results screen.
 *
 * `error` is set when the prefetch on the finding screen failed, so the
 * results screen can render an explicit "network problem, retry" UI instead
 * of the empty-DB state ("We're still adding restaurants…") — the latter is
 * a *lie* when the fetch actually errored, and tells prospects we have no
 * inventory in their area when really we just couldn't reach the API.
 *
 * `outOfArea` is set by the results screen when the preview resolves to zero
 * restaurants — i.e. the user is outside our seeded LA coverage. Downstream
 * screens (notification-permission) read it to route the user into the
 * launch-waitlist branch instead of the paywall.
 */
export const prefetchedRestaurants: {
  data: PreviewRestaurant[] | null;
  error: boolean;
  outOfArea: boolean;
} = { data: null, error: false, outOfArea: false };
