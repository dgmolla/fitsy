import { z } from 'zod';
import type { ChainLocation } from './chainGeography';

const text = z.string().trim().min(1);
const evidence = z.object({ url: z.string().url().startsWith('https://'), sha256: z.string().regex(/^[a-f0-9]{64}$/), locator: text }).strict();
/** Offline-reviewed store identity, not a region inferred from an address or a delivery-provider ID. */
export const chainStoreScopeSchema = z.object({
  directory: evidence,
  stores: z.array(z.object({
    storeId: text, lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180),
    // Approval must establish that this tolerance cannot include a different same-brand outlet.
    radiusMeters: z.number().finite().positive().max(100), association: evidence,
  }).strict()).min(1).max(2000),
}).strict().refine(scope => new Set(scope.stores.map(s => s.storeId)).size === scope.stores.length, 'Duplicate official store ID');
export type ChainStoreScope = z.infer<typeof chainStoreScopeSchema>;
export function canonicalStoreScope(scope: ChainStoreScope): ChainStoreScope {
  const canonicalEvidence = (value: ChainStoreScope['directory']) => ({ url: value.url, sha256: value.sha256, locator: value.locator });
  return { directory: canonicalEvidence(scope.directory), stores: [...scope.stores]
    .sort((a, b) => a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0)
    .map(store => ({ storeId: store.storeId, lat: store.lat, lng: store.lng,
      radiusMeters: store.radiusMeters, association: canonicalEvidence(store.association) })) };
}
/** Great-circle distance handles longitude wrap without a geocoder or remote service. */
export function chainStoreDistance(a: ChainLocation, b: ChainLocation): number {
  const radians = Math.PI / 180, lat = (b.lat - a.lat) * radians, lng = (b.lng - a.lng) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(lng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function storeScopesOverlap(a: ChainStoreScope, b: ChainStoreScope): boolean {
  return a.stores.some(first => b.stores.some(second => chainStoreDistance(first, second) <= first.radiusMeters + second.radiusMeters));
}
/** Shared by all facts with this scope; bounded cache avoids rescanning stores for every menu item. */
export function buildStoreScopeMatcher(scope: ChainStoreScope): (location?: ChainLocation) => boolean {
  const cache = new Map<string, boolean>();
  const stores = [...scope.stores].sort((a, b) => a.lat - b.lat);
  // Latitude bounds prune large directories; exact great-circle distance remains authoritative.
  const latitudeMargin = Math.max(...stores.map(store => store.radiusMeters)) / 110_000;
  return location => {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)
      || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) return false;
    const key = `${location.lat}:${location.lng}`;
    if (cache.has(key)) return cache.get(key)!;
    // Multiple nearby official stores are not a unique location identity, even if facts agree.
    let low = 0, high = stores.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (stores[middle]!.lat < location.lat - latitudeMargin) low = middle + 1;
      else high = middle;
    }
    let found = 0;
    for (let i = low; i < stores.length && stores[i]!.lat <= location.lat + latitudeMargin; i++) {
      if (chainStoreDistance(stores[i]!, location) < stores[i]!.radiusMeters && ++found > 1) break;
    }
    const result = found === 1;
    if (cache.size >= 10_000) cache.clear();
    cache.set(key, result);
    return result;
  };
}
