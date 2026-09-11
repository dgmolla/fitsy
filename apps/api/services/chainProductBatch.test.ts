import input from './chainCatalogs/chain-quality-2026-09-input.json';
import { compileChainProductBatch } from './chainProductBatch';
import { approvedChainRow, buildChainMatcher, chainReviewHash, type ChainCatalogRow, type ChainReview } from './chainCatalog';
import { parseStoreV1Response } from './menuSources/ueApiClient';
import wabaUE from '../tests/fixtures/__snapshots__/chain-batch-ue-waba-grill.json';

import { chainQualityTruth } from '../tests/fixtures/chain-quality-truth';
const batch = compileChainProductBatch(input);
const definition = batch.changes.find(c => c.canonicalKey === 'chicken-bowl')!;
function chicken(aliases = definition.aliases): ChainCatalogRow {
  const row = { id: 'chicken', brandId: 'waba', canonicalKey: definition.canonicalKey, ...definition.facts,
    source: 'official', confidence: 'HIGH', officialUrl: definition.source.url, review: null };
  const review = { version: 1 as const, sourceHash: definition.source.sha256, reviewedBy: batch.reviewedBy, locator: definition.locator, aliases };
  return { ...row, review: { ...review, dataHash: chainReviewHash(row, review) } };
}
test('manufacturer facts compile once and can bind multiple chains without sharing menu identity', () => {
  expect(batch.changes.slice(1).map(c => [c.facts.calories, c.facts.proteinG, c.facts.carbsG, c.facts.fatG])).toEqual(chainQualityTruth.slice(0, 9).map(t => t.slice(2)));
  const another = { ...input, changes: [], bindings: [input.bindings[0], { ...input.bindings[0], slug: 'another-chain' }] };
  const compiled = compileChainProductBatch(another);
  expect(compiled.changes.map(c => c.slug)).toEqual(['waba-grill', 'another-chain']);
  expect(compiled.changes[0]!.facts).toEqual(compiled.changes[1]!.facts);
  expect(compiled.changes[0]!.source).toEqual(input.products[0]!.source);
  expect(compiled.changes[0]!.locator).toBe(`US product ${input.products[0]!.key} (Pepsi); ${input.products[0]!.locator}`);
  expect(() => compileChainProductBatch({ ...input, products: [...input.products, input.products[0]] })).toThrow('Duplicate manufacturer product key');
  expect(() => compileChainProductBatch({ ...input, products: [] })).toThrow('Unknown manufacturer product');
  expect(() => compileChainProductBatch({ ...input, bindings: [input.bindings[0], input.bindings[0]] })).toThrow('Duplicate catalog key');
  expect(() => compileChainProductBatch({ ...input, products: input.products.map((p, i) => i === 0 ? { ...p, market: 'CA' } : p) })).toThrow('"market"');
});
test('a reviewed default accepts only its exact captured context and range, preserving the old alias', () => {
  const item = parseStoreV1Response(wabaUE)!.items.find(i => i.name === 'Chicken Bowl')!, match = buildChainMatcher([chicken()]);
  expect(match('waba', item)).toMatchObject({ status: 'matched', row: { calories: 640 } });
  expect(match('waba', { name: 'Chicken Bowl', section: 'Chicken', description: '' })).toMatchObject({ status: 'matched', row: { calories: 640 } });
  for (const update of [{ calorieRange: [640, 800] as [number, number] }, { calorieRange: [760, 640] as [number, number] },
    { calorieRange: [NaN, 760] as [number, number] }, { description: item.description + ' Choose any protein.' }, { calories: 640 }])
    expect(match('waba', { ...item, ...update })).toEqual({ status: 'unmatched' });
  expect(match('other-chain', item)).toEqual({ status: 'unmatched' });
  expect(match('waba', { ...definition.aliases[0]!, calorieRange: [640, 760] })).toEqual({ status: 'unmatched' });
  const bare = definition.aliases.map(({ defaultServing: _defaultServing, ...identity }) => identity);
  expect(buildChainMatcher([chicken(bare)])('waba', item)).toEqual({ status: 'unmatched' });
});
test('all default evidence is approval-bound and malformed or duplicate defaults fail closed', () => {
  const row = chicken(), review = row.review as ChainReview;
  for (const patch of [{ sourceUrl: 'https://example.com' }, { sourceHash: 'b'.repeat(64) }, { locator: 'another serving' },
    { selections: ['Brown Rice'] }, { calorieRange: [640, 800] as [number, number] }]) {
    const aliases = review.aliases.map(a => a.defaultServing ? { ...a, defaultServing: { ...a.defaultServing, ...patch } } : a);
    expect(approvedChainRow({ ...row, review: { ...review, aliases } })).toBeNull();
  }
  for (const patch of [{ calorieRange: [650, 760] }, { calorieRange: [500, 600] }, { calorieRange: [760, 640] }, { selections: [] }, { selections: [' '] }]) {
    const invalid = JSON.parse(JSON.stringify(review)) as ChainReview;
    Object.assign(invalid.aliases[1]!.defaultServing!, patch);
    expect(approvedChainRow({ ...row, review: { ...invalid, dataHash: chainReviewHash(row, invalid) } })).toBeNull();
  }
  expect(approvedChainRow(chicken([...definition.aliases, definition.aliases[1]!]))).not.toBeNull();
  const upperBoundary = chicken(definition.aliases.map(a => a.defaultServing ? { ...a, defaultServing: { ...a.defaultServing, calorieRange: [600, 640] as [number, number] } } : a));
  expect(approvedChainRow(upperBoundary)).not.toBeNull();
  expect(approvedChainRow(chicken([...definition.aliases, { ...definition.aliases[1]!, defaultServing: undefined }]))).toBeNull();
});
