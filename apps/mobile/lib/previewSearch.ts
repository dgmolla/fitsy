import { getMacroTargets } from './macroStorage';
import { FALLBACK_LAT, FALLBACK_LNG } from './useLocation';
import { getCachedCoords } from './locationCache';
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
 * preview endpoint (no auth required). Used by the finding screen (prefetch),
 * the results screen (display), and the out-of-area screen (explicit Silver
 * Lake sample — see `coordsOverride` below).
 *
 * Uses the granted coords cached by `welcome/location-permission` when
 * available; otherwise falls back to Silver Lake. The priming screen runs
 * before this in the onboarding chain, so a granted user gets a teaser
 * targeted at their actual area.
 *
 * `coordsOverride` forces specific coordinates regardless of cache — used by
 * `welcome/out-of-area.tsx` to show a Silver Lake sample even when the cache
 * holds the user's real (out-of-area) coords, which would otherwise keep
 * returning zero results.
 */
export async function fetchPreviewRestaurants(
  coordsOverride?: { lat: number; lng: number },
): Promise<PreviewRestaurant[]> {
  const [macros, cached] = await Promise.all([getMacroTargets(), getCachedCoords()]);
  const params = new URLSearchParams({
    lat: String(coordsOverride?.lat ?? cached?.lat ?? FALLBACK_LAT),
    lng: String(coordsOverride?.lng ?? cached?.lng ?? FALLBACK_LNG),
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
