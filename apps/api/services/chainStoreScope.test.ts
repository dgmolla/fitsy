import { approvedChainRow, assertUnambiguousChainAliases, buildChainMatcher, chainReviewHash, type ChainCatalogRow } from './chainCatalog';
import { buildStoreScopeMatcher, chainStoreScopeSchema, type ChainStoreScope } from './chainStoreScope';
import { chainCatalogBatchSchema } from './chainCatalogBatch';
const la = { lat: 34.0976798, lng: -118.3299269 }, bay = { lat: 37.775535, lng: -122.3934211 };
const item = { name: 'Butter Croissant', section: 'Bakery' };
const evidence = { url: 'https://example.com/locations', sha256: 'a'.repeat(64), locator: 'Retained store and guide association' };
const scope = (storeId: string, location = la): ChainStoreScope => ({ directory: evidence, stores: [{ storeId, ...location, radiusMeters: 100, association: evidence }] });
function fixture(id: string, storeScope?: ChainStoreScope): ChainCatalogRow {
 const row = { id, brandId: 'bakery', canonicalKey: id, servingSize: 'One croissant', calories: 300, proteinG: 6,
  carbsG: 33, fatG: 16, source: 'official', confidence: 'HIGH', officialUrl: 'https://example.com/nutrition', review: null };
 const review = { version: 1 as const, sourceHash: 'b'.repeat(64), locator: 'Test source', reviewedBy: 'Test fixture', aliases: [item], ...(storeScope ? { storeScope } : {}) };
 return { ...row, review: { ...review, dataHash: chainReviewHash(row, review) } };
}
test('same-state store scopes select independently and unknown identities abstain', () => {
 const rows = [fixture('la', scope('la')), fixture('bay', scope('bay', bay))], match = buildChainMatcher(rows);
 expect(() => assertUnambiguousChainAliases(rows)).not.toThrow();
 expect(match('bakery', item, la)).toMatchObject({ row: { id: 'la' } });
 expect(match('bakery', item, bay)).toMatchObject({ row: { id: 'bay' } });
 for (const location of [undefined, { lat: 34, lng: -118 }, { lat: NaN, lng: 0 }, { lat: 91, lng: 0 }]) {
  expect(match('bakery', item, location)).toEqual({ status: 'unmatched' });
 }
 expect(match('wrong', item, la)).toEqual({ status: 'unmatched' });
 expect(match('bakery', { ...item, name: 'Mini Butter Croissant' }, la)).toEqual({ status: 'unmatched' });
});
test('radius and ambiguity are conservative including overlapping unequal circles', () => {
 const nearby = { lat: la.lat + .0005, lng: la.lng };
 const matcher = buildStoreScopeMatcher(scope('la'));
 expect(matcher(nearby)).toBe(true);
 expect(matcher({ lat: la.lat + .001, lng: la.lng })).toBe(false);
 const duplicated = { ...scope('la'), stores: [...scope('la').stores, ...scope('other', nearby).stores] };
 expect(buildStoreScopeMatcher(duplicated)(la)).toBe(false);
 for (const other of [fixture('near', scope('other', nearby)), fixture('national')]) {
  expect(() => assertUnambiguousChainAliases([fixture('la', scope('la')), other])).toThrow('Ambiguous reviewed alias');
 }
 const rows = [fixture('la', scope('la')), fixture('near', scope('other', nearby))];
 expect(buildChainMatcher(rows)('bakery', item, nearby)).toEqual({ status: 'ambiguous' });
 expect(buildStoreScopeMatcher(scope('wrap', { lat: 0, lng: 179.9999 }))({ lat: 0, lng: -179.9999 })).toBe(true);
});
test('every evidence and geographic field is approval-bound; ordering is cosmetic', () => {
 const original = { ...scope('la'), stores: [...scope('la').stores, ...scope('bay', bay).stores] };
 const row = fixture('both', original), review = approvedChainRow(row)!.review;
 expect(approvedChainRow({ ...row, review: { ...review, storeScope: { ...original, stores: [...original.stores].reverse() } } })).not.toBeNull();
 const reversedKeys = JSON.parse(JSON.stringify(original, null, 2));
 reversedKeys.directory = { locator: evidence.locator, sha256: evidence.sha256, url: evidence.url };
 expect(approvedChainRow({ ...row, review: { ...review, storeScope: reversedKeys } })).not.toBeNull();
 for (const changed of [undefined, { ...original, directory: { ...evidence, sha256: 'c'.repeat(64) } },
  ...['storeId', 'lat', 'lng', 'radiusMeters', 'association'].map(key => ({ ...original, stores: [{ ...original.stores[0],
   [key]: key === 'storeId' ? 'changed' : key === 'association' ? { ...evidence, locator: 'changed' } : key === 'radiusMeters' ? 50 : 0 }, original.stores[1]] }))]) {
  expect(approvedChainRow({ ...row, review: { ...review, storeScope: changed } })).toBeNull();
 }
});
test('scope requires bounded unique stores with source evidence and survives batch parsing', () => {
 for (const changed of [{ ...scope('la'), stores: [] }, { ...scope('la'), stores: [...scope('la').stores, ...scope('la').stores] },
  { ...scope('la'), stores: [{ ...scope('la').stores[0], radiusMeters: 101 }] }]) expect(chainStoreScopeSchema.safeParse(changed).success).toBe(false);
 const row = fixture('la', scope('la'));
 const batch = chainCatalogBatchSchema.parse({ version: 1, reviewedBy: 'Test', changes: [{ slug: 'bakery', canonicalKey: 'la', expected: null,
  facts: { calories: 300, proteinG: 6, carbsG: 33, fatG: 16, servingSize: 'One croissant' }, source: { url: row.officialUrl, sha256: 'b'.repeat(64) },
  locator: 'Test', aliases: [item], storeScope: scope('la') }], quarantine: [] });
 expect(batch.changes[0]!.storeScope).toEqual(scope('la'));
});
