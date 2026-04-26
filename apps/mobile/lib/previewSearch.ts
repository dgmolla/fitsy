import { getMacroTargets } from './macroStorage';
import { FALLBACK_LAT, FALLBACK_LNG } from './useLocation';
import { api } from './api';

export interface PreviewRestaurant {
  id: string;
  name: string;
  cuisineTags: string[];
  distanceMiles: number;
  photoUrl?: string;
}

/**
 * Fetch nearby restaurants matching the user's macro targets via the
 * preview endpoint (no auth required). Used by both the finding screen
 * (prefetch) and the results screen (display).
 */
export async function fetchPreviewRestaurants(): Promise<PreviewRestaurant[]> {
  const macros = await getMacroTargets();
  const params = new URLSearchParams({
    lat: String(FALLBACK_LAT),
    lng: String(FALLBACK_LNG),
    ...(macros?.protein ? { protein: macros.protein } : {}),
    ...(macros?.carbs ? { carbs: macros.carbs } : {}),
    ...(macros?.fat ? { fat: macros.fat } : {}),
    ...(macros?.calories ? { calories: macros.calories } : {}),
  });
  const res = await api.get<{ data: PreviewRestaurant[] }>(
    `/api/restaurants/preview?${params.toString()}`,
  );
  return res.data;
}
