import manifest from './chainCatalogs/waba-yoshinoya-2026-09.json';
import observations from '../tests/fixtures/__snapshots__/chain-batch-observations.json';
import extraction from '../tests/fixtures/__snapshots__/chain-batch-source-extraction.json';
import wabaUE from '../tests/fixtures/__snapshots__/chain-batch-ue-waba-grill.json';
import yoshiUE from '../tests/fixtures/__snapshots__/chain-batch-ue-yoshinoya.json';
import { parseStoreV1Response } from './menuSources/ueApiClient';
import { chainCatalogBatchSchema } from './chainCatalogBatch';
import { chainBatchTruth, chainBindingTruth } from '../tests/fixtures/chain-batch-truth';
import { chainMenuFingerprint, buildChainMatcher, chainReviewHash } from './chainCatalog';
const batch = chainCatalogBatchSchema.parse(manifest);
test('every bound serving agrees with separately transcribed PDF macros', () => {
  expect(chainBatchTruth).toHaveLength(71);
  expect(batch.changes.filter(r => r.aliases.length).map(r => r.slug + ':' + r.canonicalKey).sort()).toEqual(chainBatchTruth.map(r => r[0] + ':' + r[1]).sort());
  for (const [slug, key, calories, proteinG, carbsG, fatG] of chainBatchTruth) expect(batch.changes.find(r => r.slug === slug && r.canonicalKey === key)?.facts).toMatchObject({ calories, proteinG, carbsG, fatG });
});
test('all 197 extracted source rows are accounted for; held facts are absent and components have no meal aliases', () => {
  expect(extraction).toHaveLength(197);
  expect(extraction.filter(r => r.factStatus === 'held')).toHaveLength(16);
  expect(batch.changes).toHaveLength(182); // 181 published facts + fixed two-cookie derivation.
  for (const row of extraction) {
    const definition = batch.changes.find(c => c.slug === (row.brand === 'waba' ? 'waba-grill' : row.brand) && c.canonicalKey === row.canonicalKey);
    if (row.factStatus === 'held') expect(definition).toBeUndefined();
    else expect(definition?.facts).toMatchObject({ calories: Math.round(row.calories), proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG });
  }
  for (const row of batch.changes.filter(r => /family-a-la-carte|combo.*select/.test(r.canonicalKey))) expect(row.aliases).toEqual([]);
});
test('every approved binding has an actual menu observation, and no unseen name-only aliases are created', () => {
  const seen = new Set(observations.map(r => r.slug + ':' + chainMenuFingerprint(r)));
  const aliases = batch.changes.flatMap(r => r.aliases.map(a => r.slug + ':' + chainMenuFingerprint(a)));
  expect(aliases).toHaveLength(95);
  for (const alias of aliases) expect(seen.has(alias)).toBe(true);
});

const match = buildChainMatcher(batch.changes.map(c => {
  const row = { id: c.slug + ':' + c.canonicalKey, brandId: c.slug, canonicalKey: c.canonicalKey, ...c.facts, source: 'official', confidence: 'HIGH', officialUrl: c.source.url, review: null };
  const evidence = { version: 1 as const, sourceHash: c.source.sha256, locator: c.locator, reviewedBy: batch.reviewedBy, aliases: c.aliases };
  return { ...row, review: { ...evidence, dataHash: chainReviewHash(row, evidence) } };
}));
test.each(chainBindingTruth)('%s %s keeps its reviewed menu identity', (slug, key, item) => {
  const [, , calories, proteinG, carbsG, fatG] = chainBatchTruth.find(r => r[0] === slug && r[1] === key)!;
  expect(match(slug, item)).toMatchObject({ status: 'matched', row: { canonicalKey: key, calories, proteinG, carbsG, fatG } });
});
test('binding oracle covers every approved alias exactly once', () => {
  const expected = chainBindingTruth.map(([slug, key, item]) => slug + ':' + key + ':' + chainMenuFingerprint(item));
  const actual = batch.changes.flatMap(r => r.aliases.map(a => r.slug + ':' + r.canonicalKey + ':' + chainMenuFingerprint(a)));
  expect(new Set(expected).size).toBe(95); expect(actual.sort()).toEqual(expected.sort());
});
test('every ranged raw listing stays unbound even without its label, including duplicate sections', () => {
  let checked = 0;
  for (const [slug, raw] of [['waba-grill', wabaUE], ['yoshinoya', yoshiUE]] as const) {
    for (const section of Object.values(raw.data.catalogSectionsMap).flat()) {
      for (const item of parseStoreV1Response({ data: { catalogSectionsMap: { only: [section] } } })?.items ?? []) {
        if (!item.calorieRange) continue;
        expect(match(slug, { name: item.name, section: item.section ?? '', description: item.description ?? '' }).status).toBe('unmatched'); checked++;
      }
    }
  }
  expect(checked).toBe(28);
});
test('known conflicts, configurable dishes and changed recipes remain unresolved', () => {
  const held = observations.filter(o => (o.slug === 'waba-grill' && ['Shrimp Bowl', 'Shrimp Veggie Bowl', 'Shrimp Plate', '10 Dumplings', 'Chicken Family Meal', 'Family Sized Proteins', 'Tacos'].includes(o.name))
    || (o.slug === 'yoshinoya' && ['Combo Bowl', 'Combo XL Bowl', 'Kids Original Gyudon Beef', 'Kids Teriyaki Grilled Chicken', 'Original Gyudon Beef Bowl®', 'White Rice', 'Brown Rice', 'Crispy Gyoza', 'Grilled Chicken', 'Cheesecake'].includes(o.name))
    || (o.slug === 'waba-grill' && o.name === 'Chicken Bowl' && ['Featured items', 'Rice Bowls'].includes(o.section))
    || (o.slug === 'waba-grill' && o.name === 'Signature House' && !o.description.includes('white meat chicken')));
  expect(held).toHaveLength(29);
  for (const row of held) expect(match(row.slug, row).status).toBe('unmatched');
});
