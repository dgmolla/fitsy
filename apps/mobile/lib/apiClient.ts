import { MenuApiResponse, MenuResponse, RestaurantResult, RestaurantsApiResponse, SavedItemResponse, SavedItemsResponse } from '@fitsy/shared';
import { api } from './api';

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
}

export async function fetchRestaurants(
  params: FetchRestaurantsParams
): Promise<RestaurantResult[]> {
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

  const reqId = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  console.log(JSON.stringify({ event: 'fitsy_search_client_start', reqId, t0 }));
  try {
    const response = await api.get<RestaurantsApiResponse>(
      `/api/restaurants?${qs.toString()}`, true
    );
    const t1 = Date.now();

    if ('error' in response) {
      console.log(JSON.stringify({ event: 'fitsy_search_client_done', reqId, ok: false, client_total_ms: t1 - t0 }));
      return [];
    }

    console.log(JSON.stringify({ event: 'fitsy_search_client_done', reqId, ok: true, client_total_ms: t1 - t0, results: response.data.length }));
    return response.data;
  } catch (err) {
    const t1 = Date.now();
    console.log(JSON.stringify({ event: 'fitsy_search_client_done', reqId, ok: false, client_total_ms: t1 - t0, err: String(err) }));
    return [];
  }
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
