import { getDiscoveryMacroTargets } from './macroStorage';
import { getCachedCoords } from './locationCache';
import { api } from './api';

export interface PreviewRestaurant {
  id: string;
  name: string;
  cuisineTags: string[];
  distanceMiles: number;
  photoUrl?: string;
}

/** Legacy win-back cards use only the user's chosen area. No location means
 * no local claims; the paywall remains usable without restaurant cards. */
export async function fetchPreviewRestaurants(
  coordsOverride?: { lat: number; lng: number },
  options: { signal?: AbortSignal; expectedUserId?: string } = {},
): Promise<PreviewRestaurant[]> {
  const [macros, cached] = await Promise.all([getDiscoveryMacroTargets(), getCachedCoords()]);
  if (options.signal?.aborted) throw new Error('Preview request cancelled');
  const coords = coordsOverride ?? cached;
  if (!coords) return [];
  const params = new URLSearchParams({
    lat: String(coords.lat),
    lng: String(coords.lng),
    ...(macros?.protein ? { protein: macros.protein } : {}),
    ...(macros?.carbs ? { carbs: macros.carbs } : {}),
    ...(macros?.fat ? { fat: macros.fat } : {}),
    ...(macros?.calories ? { calories: macros.calories } : {}),
  });
  const res = await api.get<{ data: PreviewRestaurant[] }>(
    `/api/restaurants/preview?${params.toString()}`,
    true, { signal: options.signal }, options.expectedUserId,
  );
  return res.data;
}
