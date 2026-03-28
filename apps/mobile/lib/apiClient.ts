import { MenuApiResponse, MenuResponse, RestaurantResult, RestaurantsApiResponse, SavedItemResponse, SavedItemsResponse } from '@fitsy/shared';
import { api } from './api';

export interface FetchRestaurantsParams {
  protein?: number;
  carbs?: number;
  fat?: number;
  calories?: number;
  lat: number;
  lng: number;
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

  const response = await api.get<RestaurantsApiResponse>(
    `/api/restaurants?${qs.toString()}`, true
  );

  if ('error' in response) {
    throw new Error((response as { error: string }).error);
  }

  return response.data;
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
