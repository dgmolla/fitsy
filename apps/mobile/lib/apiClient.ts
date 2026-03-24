import { RestaurantResult, RestaurantsApiResponse } from '@fitsy/shared';
import { api } from './api';

// Hardcoded to Silver Lake, LA (90029) — real location added in a later sprint.
const DEFAULT_LAT = 34.0869;
const DEFAULT_LNG = -118.3269;

export interface FetchRestaurantsParams {
  protein?: number;
  carbs?: number;
  fat?: number;
  calories?: number;
  lat?: number;
  lng?: number;
}

export async function fetchRestaurants(
  params: FetchRestaurantsParams
): Promise<RestaurantResult[]> {
  const lat = params.lat ?? DEFAULT_LAT;
  const lng = params.lng ?? DEFAULT_LNG;

  const qs = new URLSearchParams();
  qs.set('lat', String(lat));
  qs.set('lng', String(lng));

  if (params.protein !== undefined) qs.set('protein', String(params.protein));
  if (params.carbs !== undefined) qs.set('carbs', String(params.carbs));
  if (params.fat !== undefined) qs.set('fat', String(params.fat));
  if (params.calories !== undefined) qs.set('calories', String(params.calories));

  const response = await api.get<RestaurantsApiResponse>(
    `/api/restaurants?${qs.toString()}`
  );

  if ('error' in response) {
    throw new Error(response.error);
  }

  return response.data;
}
