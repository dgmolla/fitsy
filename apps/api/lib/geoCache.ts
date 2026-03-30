/**
 * In-memory LRU geo cache for restaurant data.
 *
 * Caches restaurant + menu macro data by geo grid cell.
 * Shared across all users in the same area — scoring happens
 * per-user after cache lookup.
 */

export interface CachedMenuItem {
  menuItemId: string;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: string;
}

export interface CachedRestaurant {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  cuisineTags: string[];
  chainFlag: boolean;
  photoUrl: string | null;
  menuItems: CachedMenuItem[];
}

interface CacheEntry {
  data: CachedRestaurant[];
  createdAt: number;
}

const GRID_PRECISION = 2; // decimal places → ~0.7 mile cells
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 500;

const cache = new Map<string, CacheEntry>();

function roundCoord(v: number): number {
  const factor = Math.pow(10, GRID_PRECISION);
  return Math.round(v * factor) / factor;
}

export function geoCacheKey(
  lat: number,
  lng: number,
  radiusMiles: number,
  cuisineType?: string,
  chainOnly?: boolean,
): string {
  const parts = [
    roundCoord(lat),
    roundCoord(lng),
    radiusMiles,
  ];
  if (cuisineType !== undefined) parts.push(cuisineType as unknown as number);
  if (chainOnly !== undefined) parts.push(chainOnly ? 1 : 0);
  return parts.join(":");
}

export function geoCacheGet(key: string): CachedRestaurant[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function geoCacheSet(key: string, data: CachedRestaurant[]): void {
  // LRU eviction: remove oldest if at capacity
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { data, createdAt: Date.now() });
}

export function geoCacheStats(): { size: number; maxEntries: number } {
  return { size: cache.size, maxEntries: MAX_ENTRIES };
}

export function geoCacheClear(): void {
  cache.clear();
}
