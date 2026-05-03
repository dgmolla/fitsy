import type { PreviewRestaurant } from './previewSearch';

/**
 * Shared cache so the finding screen can pre-fetch for the results screen.
 *
 * `error` is set when the prefetch on the finding screen failed, so the
 * results screen can render an explicit "network problem, retry" UI instead
 * of the empty-DB state ("We're still adding restaurants…") — the latter is
 * a *lie* when the fetch actually errored, and tells prospects we have no
 * inventory in their area when really we just couldn't reach the API.
 */
export const prefetchedRestaurants: {
  data: PreviewRestaurant[] | null;
  error: boolean;
} = { data: null, error: false };
