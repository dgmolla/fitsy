import { FeedbackBoardPost, FeedbackBoardResponse, FeedbackVoteResponse, MenuApiResponse, MenuResponse, RestaurantResult, RestaurantsApiResponse, SavedItemResponse, SavedItemsResponse } from '@fitsy/shared';
import { api, SubscriptionRequiredError } from './api';

export interface FetchRestaurantsParams {
  protein?: number;
  carbs?: number;
  fat?: number;
  calories?: number;
  lat: number;
  lng: number;
  cuisineType?: string;
  dietary?: string;
  maxPriceLevel?: string;
  minRating?: number;
  /**
   * Free-text query. Sent as `q`; the API matches it against restaurant name,
   * cuisineTags, and menu item names/descriptions. Filters results without
   * changing the macro+distance ranking.
   */
  query?: string;
  /**
   * Opaque cursor returned by a previous call as `meta.nextCursor`. When
   * supplied, the API resumes paging strictly after the last row of the
   * previous page (tie-broken by id within equal distances).
   */
  cursor?: string;
}

/**
 * Fetches a single page. Returns both the data and the encoded cursor for
 * the next page (or `null` if this page exhausted the result set). Callers
 * driving infinite-scroll lists should prefer this over `fetchRestaurants`.
 */
export async function fetchRestaurantsPage(
  params: FetchRestaurantsParams,
): Promise<{ data: RestaurantResult[]; nextCursor: string | null; total: number; locked: boolean; networkError: boolean }> {
  const { lat, lng } = params;

  const qs = new URLSearchParams();
  qs.set('lat', String(lat));
  qs.set('lng', String(lng));

  if (params.protein !== undefined) qs.set('protein', String(params.protein));
  if (params.carbs !== undefined) qs.set('carbs', String(params.carbs));
  if (params.fat !== undefined) qs.set('fat', String(params.fat));
  if (params.calories !== undefined) qs.set('calories', String(params.calories));
  if (params.cuisineType !== undefined) qs.set('cuisineType', params.cuisineType);
  if (params.dietary !== undefined) qs.set('dietary', params.dietary);
  if (params.maxPriceLevel !== undefined) qs.set('maxPriceLevel', params.maxPriceLevel);
  if (params.minRating !== undefined) qs.set('minRating', String(params.minRating));
  if (params.query !== undefined && params.query.trim() !== '') qs.set('q', params.query.trim());
  if (params.cursor !== undefined) qs.set('cursor', params.cursor);

  const reqId = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event: 'fitsy_search_client_start', reqId, t0, paginated: params.cursor !== undefined }));
  try {
    const response = await api.get<RestaurantsApiResponse>(
      `/api/restaurants?${qs.toString()}`,
      true,
    );
    const t1 = Date.now();

    if ('error' in response) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ event: 'fitsy_search_client_done', reqId, ok: false, client_total_ms: t1 - t0 }));
      return { data: [], nextCursor: null, total: 0, locked: false, networkError: true };
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'fitsy_search_client_done', reqId, ok: true, client_total_ms: t1 - t0, results: response.data.length }));
    return { data: response.data, nextCursor: response.meta.nextCursor ?? null, total: response.meta.total, locked: response.meta.locked ?? false, networkError: false };
  } catch (err) {
    const t1 = Date.now();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'fitsy_search_client_done', reqId, ok: false, client_total_ms: t1 - t0, err: String(err) }));
    // Other errors stay swallowed as an empty page (network blips read as
    // "nothing nearby" in the list itself, not a crash) - but `networkError:
    // true` lets callers that need to tell "no matches" apart from "couldn't
    // reach the API" (e.g. the onboarding out-of-area check) still do so.
    // `/api/restaurants` no longer 402s (an unentitled caller gets a locked
    // 200 instead), but SubscriptionRequiredError stays defined for other
    // authenticated routes that still gate this way.
    if (err instanceof SubscriptionRequiredError) throw err;
    return { data: [], nextCursor: null, total: 0, locked: false, networkError: true };
  }
}

/**
 * @deprecated Prefer `fetchRestaurantsPage` for new callers — it surfaces
 * `nextCursor` so the list can paginate. Retained for callers that only
 * need the first page and don't paginate.
 */
export async function fetchRestaurants(
  params: FetchRestaurantsParams,
): Promise<RestaurantResult[]> {
  const { data } = await fetchRestaurantsPage(params);
  return data;
}

export async function fetchMenu(restaurantId: string): Promise<MenuResponse | null> {
  try {
    const response = await api.get<MenuApiResponse>(
      `/api/restaurants/${restaurantId}/menu`, true
    );

    if ('error' in response) {
      return null;
    }

    return response.data;
  } catch {
    return null;
  }
}

export async function getSavedItems(cursor?: string): Promise<SavedItemsResponse | null> {
  try {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const response = await api.get<SavedItemsResponse>(`/api/saved-items${qs}`, true);
    return response;
  } catch {
    return null;
  }
}

export async function saveItem(menuItemId: string): Promise<SavedItemResponse | null> {
  try {
    const response = await api.post<{ data: SavedItemResponse }>(
      '/api/saved-items',
      { menuItemId }
    );
    return response.data;
  } catch {
    return null;
  }
}

export async function unsaveItem(savedItemId: string): Promise<boolean> {
  try {
    await api.del(`/api/saved-items/${savedItemId}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends free-text feedback to the team inbox. Returns true on success; on
 * failure returns the server-provided error message (or a generic fallback)
 * so the caller can surface it to the user.
 */
export async function sendFeedback(
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api.post('/api/feedback', { message }, true);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not send feedback',
    };
  }
}

/** Fetches a page of the public feedback board, most-upvoted first. */
export async function getFeedbackBoard(cursor?: string): Promise<FeedbackBoardResponse | null> {
  try {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return await api.get<FeedbackBoardResponse>(`/api/feedback${qs}`, true);
  } catch {
    return null;
  }
}

/** Toggles the current user's upvote on a board post. */
export async function voteFeedback(
  feedbackId: string,
): Promise<Pick<FeedbackBoardPost, 'voteCount' | 'hasVoted'> | null> {
  try {
    const response = await api.post<{ data: FeedbackVoteResponse }>(
      `/api/feedback/${feedbackId}/vote`,
      {},
      true,
    );
    return response.data;
  } catch {
    return null;
  }
}

export interface SubscriptionSyncResult {
  /** Server-trusted entitlement after the sync. */
  active: boolean;
  /** False when the server couldn't reach RevenueCat and `active` is its existing state. */
  synced: boolean;
}

/**
 * Ask the API to re-read this user's entitlement straight from RevenueCat
 * and persist it. Called right after a purchase/restore (so the next search
 * isn't racing the webhook) and whenever the device says Pro while the API
 * still serves locked responses (a subscription transferred to this account,
 * or a webhook delivery that never landed). Throws on network/HTTP failure -
 * callers treat it as best-effort.
 */
export async function syncSubscription(): Promise<SubscriptionSyncResult> {
  return api.post<SubscriptionSyncResult>('/api/subscriptions/sync', {}, true);
}
