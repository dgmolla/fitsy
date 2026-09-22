import { approvedChainRow, assertUnambiguousChainAliases, buildChainMatcher, chainReviewHash, type ChainCatalogRow } from './chainCatalog';
import { buildStoreScopeMatcher, chainStoreScopeSchema, storeScopesOverlap, chainStoreDistance, type ChainStoreScope } from './chainStoreScope';
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

test('overlap needs the sum of both radii, including unequal tolerances', () => {
 const separated = { lat: la.lat + 150 / 111_195, lng: la.lng };
 const first = fixture('la', scope('la')), otherScope = scope('other', separated);
 expect(() => assertUnambiguousChainAliases([first, fixture('other', otherScope)])).toThrow('Ambiguous reviewed alias');
 otherScope.stores[0]!.radiusMeters = 20;
 expect(() => assertUnambiguousChainAliases([first, fixture('other', otherScope)])).not.toThrow();
});
test('state restriction still rejects a location inside an approved store circle', () => {
 const row = fixture('la', scope('la')), original = approvedChainRow(row)!.review;
 const review = { ...original, usStates: ['NV'] };
 const constrained = { ...row, review: { ...review, dataHash: chainReviewHash(row, review) } };
 expect(approvedChainRow(constrained)).not.toBeNull();
 expect(buildChainMatcher([constrained])('bakery', item, la)).toEqual({ status: 'unmatched' });
});
test('latitude pruning keeps first, middle and last stores reachable in either argument order', () => {
 const multi = { ...scope('middle'), stores: [...scope('last', { lat: 38, lng: -118 }).stores,
  ...scope('first', { lat: 30, lng: -118 }).stores, ...scope('middle', { lat: 34, lng: -118 }).stores] };
 const match = buildStoreScopeMatcher(multi);
 for (const lat of [30, 34, 38]) expect(match({ lat, lng: -118 })).toBe(true);
 expect(match({ lat: 35, lng: -118 })).toBe(false);
 for (const lat of [30, 34, 38]) {
  const near = fixture('near', scope('near', { lat: lat + 150 / 111_195, lng: -118 }));
  for (const rows of [[fixture('multi', multi), near], [near, fixture('multi', multi)]]) {
   expect(() => assertUnambiguousChainAliases(rows)).toThrow();
  }
 }
});
test('invalid coordinates, nonpositive radii and insecure evidence are rejected', () => {
 for (const store of [{ ...scope('la').stores[0], radiusMeters: 0 }, { ...scope('la').stores[0], radiusMeters: -1 },
  { ...scope('la').stores[0], lat: 91 }, { ...scope('la').stores[0], lng: 181 },
  { ...scope('la').stores[0], association: { ...evidence, url: 'http://example.com' } }]) {
  expect(chainStoreScopeSchema.safeParse({ ...scope('la'), stores: [store] }).success).toBe(false);
 }
 expect(chainStoreScopeSchema.safeParse({ ...scope('la'), directory: { ...evidence, url: 'http://example.com' } }).success).toBe(false);
});

test('same-latitude points still require great-circle distance inside each tolerance', () => {
 const east = { lat: la.lat, lng: la.lng + .01 };
 expect(buildStoreScopeMatcher(scope('la'))(east)).toBe(false);
 expect(() => assertUnambiguousChainAliases([fixture('la', scope('la')), fixture('east', scope('east', east))])).not.toThrow();
 const nearby = { lat: la.lat, lng: la.lng + 150 / (111_195 * Math.cos(la.lat * Math.PI / 180)) };
 const other = scope('east', nearby);
 expect(storeScopesOverlap(scope('la'), other)).toBe(true);
 other.stores[0]!.radiusMeters = 20;
 expect(storeScopesOverlap(scope('la'), other)).toBe(false);
});
test('conservative latitude windows retain locations just inside the true distance boundary', () => {
 expect(buildStoreScopeMatcher(scope('la'))({ lat: la.lat + 99.7 / 111_195, lng: la.lng })).toBe(true);
 expect(storeScopesOverlap(scope('la'), scope('near', { lat: la.lat + 199.5 / 111_195, lng: la.lng }))).toBe(true);
});
test('latitude pruning agrees with exhaustive comparison for varied deterministic directories', () => {
 for (let example = 0; example < 80; example++) {
  const base = { lat: -75 + example * 1.8, lng: -170 + example * 4 };
  const make = (side: number): ChainStoreScope => ({ directory: evidence, stores: Array.from({ length: 9 }, (_, index) => ({
   storeId: `${side}-${index}`, lat: base.lat + Math.sin(index * 2.1 + side + example) * .004,
   lng: base.lng + Math.cos(index * 1.3 + side * 2 + example) * .008,
   radiusMeters: 10 + (index * 17 + example * 13 + side * 23) % 90, association: evidence,
  })) });
  const a = make(0), b = make(1);
  const expected = a.stores.some(first => b.stores.some(second => chainStoreDistance(first, second) <= first.radiusMeters + second.radiusMeters));
  expect(storeScopesOverlap(a, b)).toBe(expected);
  expect(storeScopesOverlap(b, a)).toBe(expected);
  const match = buildStoreScopeMatcher(a);
  for (const point of b.stores) {
   expect(match(point)).toBe(a.stores.filter(store => chainStoreDistance(store, point) < store.radiusMeters).length === 1);
  }
 }
});
