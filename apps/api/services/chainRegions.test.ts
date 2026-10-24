import { approvedChainRow, assertUnambiguousChainAliases, buildChainMatcher, chainReviewHash, type ChainCatalogRow } from './chainCatalog';
import { chainCatalogBatchSchema } from './chainCatalogBatch';
const item = { name: 'Butter Croissant', section: 'Bakery' }, ca = { lat: 34.0522, lng: -118.2437 }, oh = { lat: 41.4993, lng: -81.6944 };
function fixture(id: string, usStates?: string[]): ChainCatalogRow {
  const row = { id, brandId: 'bakery', canonicalKey: id, servingSize: 'One croissant', calories: 300, proteinG: 6,
    carbsG: 33, fatG: 16, source: 'official', confidence: 'HIGH', officialUrl: 'https://example.com/nutrition.pdf', review: null };
  const evidence = { version: 1 as const, sourceHash: 'a'.repeat(64), locator: 'Regional guide', reviewedBy: 'Fixture', aliases: [item], ...(usStates ? { usStates } : {}) };
  return { ...row, review: { ...evidence, dataHash: chainReviewHash(row, evidence) } };
}
test('scope is hash-bound; ordering is cosmetic but adding/removing states is not', () => {
  const row = fixture('west', ['CA', 'OR']), review = approvedChainRow(row)!.review;
  expect(review.dataHash).toBe('c61aa67f81967d6d9929b968d84a4eda6918890d8c459a3ea8be824d5742c4ea');
  expect(approvedChainRow({ ...row, review: { ...review, usStates: ['OR', 'CA'] } })).not.toBeNull();
  for (const usStates of [undefined, [], ['CA'], ['CA', 'OR', 'OH']]) expect(approvedChainRow({ ...row, review: { ...review, usStates } })).toBeNull();
  const batch = { version: 1, reviewedBy: 'Fixture', changes: [{ slug: 'bakery', canonicalKey: 'west', expected: null,
    facts: { calories: 300, proteinG: 6, carbsG: 33, fatG: 16, servingSize: 'One croissant' },
    source: { url: row.officialUrl, sha256: 'a'.repeat(64) }, locator: 'Regional guide', aliases: [item], usStates: ['CA', 'OR'] }], quarantine: [] };
  expect(chainCatalogBatchSchema.parse(batch).changes[0]!.usStates).toEqual(['CA', 'OR']);
});
test('disjoint regional aliases coexist; unknown location cannot select a regional default', () => {
  const rows = [fixture('west', ['CA']), fixture('east', ['OH'])], match = buildChainMatcher(rows);
  expect(() => assertUnambiguousChainAliases(rows)).not.toThrow();
  expect(match('bakery', item, ca)).toMatchObject({ row: { id: 'west' } });
  expect(match('bakery', item, oh)).toMatchObject({ row: { id: 'east' } });
  for (const location of [undefined, { lat: 0, lng: 0 }, { lat: 47.6062, lng: -122.3321 }]) expect(match('bakery', item, location)).toEqual({ status: 'unmatched' });
  expect(match('other', item, ca)).toEqual({ status: 'unmatched' });
});
test('overlapping regional and national claims remain ambiguous, even with identical macros', () => {
  for (const row of [fixture('overlap', ['CA', 'OR']), fixture('national')]) {
    const rows = [fixture('west', ['CA']), row];
    expect(() => assertUnambiguousChainAliases(rows)).toThrow(`Ambiguous reviewed alias: Butter Croissant; brand bakery; west overlaps ${row.canonicalKey}`);
    expect(buildChainMatcher(rows)('bakery', item, ca)).toEqual({ status: 'ambiguous' });
  }
  expect(buildChainMatcher([fixture('national')])('bakery', item)).toMatchObject({ status: 'matched', row: { id: 'national' } });
});
