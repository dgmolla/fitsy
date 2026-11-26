import * as SecureStore from 'expo-secure-store';

const KEY = 'fitsy_last_known_coords';
export const MANUAL_LOCATION_KEY = 'fitsy_manual_location';

export interface CachedCoords {
  lat: number;
  lng: number;
}

let memoryCache: CachedCoords | null = null;

export async function setCachedCoords(coords: CachedCoords): Promise<void> {
  memoryCache = coords;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(coords));
  } catch {
    // SecureStore failure is non-fatal — memoryCache still serves the rest of
    // this app session, and the next grant will retry persistence.
  }
}

export async function getCachedCoords(): Promise<CachedCoords | null> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCoords;
    if (typeof parsed?.lat !== 'number' || typeof parsed?.lng !== 'number') return null;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

/** Forget the saved area (GPS cache and manual pick) so the next account on this device starts fresh (#839). */
export async function clearSavedLocation(): Promise<void> {
  memoryCache = null;
  await Promise.allSettled([SecureStore.deleteItemAsync(KEY), SecureStore.deleteItemAsync(MANUAL_LOCATION_KEY)]);
}
