import { auditChainCoverage, LA_CHAIN_BOUNDS } from './chainCoverage';
import { approvedChainRow, chainReviewHash, chainReviewSchema } from './chainCatalog';
import { officialMacro } from './chainServing';
import { chainCatalogBatchSchema } from './chainCatalogBatch';
import { coverageSnapshotFixture as snapshot, coverageBatchFixture as batch, coverageBindingFixture as binding, coverageFixtureDate as now } from '../tests/fixtures/chainCoverage';

test('same-cohort per-chain report separates baseline from proposal and keeps KFC blocked', () => {
  const proposal = batch([{ ...binding, canonicalKey: 'drink', aliases: [{ name: 'Drink', section: 'Entrees', sourceItemId: 'ubereats:drink' }] }]);
  const input = snapshot(), untouched = JSON.stringify(input);
  const report = auditChainCoverage(input, proposal, .8);
  expect(JSON.stringify(input)).toBe(untouched);
  expect(report).toMatchObject({ origin: 'fixture', proposalsOnly: true, applied: false, retiredRowsExcluded: 1,
    totals: { before: { items: 4, matched: 1, unmatched: 3 }, after: { items: 4, matched: 3, unmatched: 1 },
      beforeShare: .25, projectedShare: .75, additionalMatches: 2, targetMet: false, additionalRowsNeeded: 1 } });
  expect(report.chains.find(c => c.slug === 'kfc')).toMatchObject({ approvedFactsBefore: 0, approvedFactsAfter: 0,
    before: { matched: 0, unmatched: 1 }, after: { matched: 0, unmatched: 1 } });
  const baseline = auditChainCoverage(input);
  expect(baseline.unmatchedGroups[0]).toMatchObject({ slug: 'fixture', name: 'Drink', rows: 2,
    variants: [{ sourceItemId: 'ubereats:drink', rows: 2 }] });
  expect(baseline.totals.targetMet).toBeNull();
});

test('identity holds, ambiguous bindings and merchant overrides never inflate official coverage', () => {
  const input = snapshot();
  input.restaurants[0]!.name = 'Unverified near-name Fixture';
  expect(auditChainCoverage(input).totals.before).toMatchObject({ matched: 0, unmatched: 4, identityHolds: 3 });
  input.restaurants[0]!.name = 'Fixture';
  const duplicate = { ...input.catalog[0]!, id: 'duplicate', canonicalKey: 'another' };
  const review = chainReviewSchema.parse(duplicate.review);
  duplicate.review = JSON.parse(JSON.stringify({ ...review, dataHash: chainReviewHash(duplicate, review) }));
  input.catalog.push(duplicate);
  expect(auditChainCoverage(input).totals.before).toMatchObject({ matched: 0, ambiguous: 1, unmatched: 3 });
  input.catalog.pop();
  const estimate = { source: 'official', confidence: 'HIGH', reasoning: officialMacro(approvedChainRow(input.catalog[0]!)!, {
    name: 'Plate', section: 'Entrees', sourceItemId: 'ubereats:plate' }).reasoning,
    calories: 410, proteinG: 20, carbsG: 50, fatG: 10, estimatedAt: now };
  Object.assign(input.items[0]!, estimate, { macroEstimates: [estimate] });
  expect(auditChainCoverage(input).totals.before).toMatchObject({ servedOfficial: 1, consistentOfficial: 1 });
  input.items[0]!.macroEstimates.push({ ...estimate, source: 'merchant', calories: 420 });
  expect(auditChainCoverage(input).totals.before).toMatchObject({ servedOfficial: 0, consistentOfficial: 0 });
});

test('unsafe snapshots, targets, stale baselines and proposals losing current matches fail closed', () => {
  const input = snapshot();
  expect(() => auditChainCoverage({ ...input, items: [] })).toThrow('No active LA');
  expect(() => auditChainCoverage({ ...input, items: [input.items[0], input.items[0]] })).toThrow('Duplicate');
  expect(() => auditChainCoverage({ ...input, restaurants: [] })).toThrow('Incomplete');
  expect(() => auditChainCoverage({ ...input, bounds: { ...LA_CHAIN_BOUNDS, minLat: 0 } })).toThrow('bounds');
  expect(() => auditChainCoverage({ ...input, restaurants: input.restaurants.map(r => ({ ...r, lat: 0 })) })).toThrow('outside');
  for (const target of [0, -1, 1.1, NaN, Infinity]) expect(() => auditChainCoverage(input, undefined, target)).toThrow('Target');
  expect(() => auditChainCoverage(input, batch([{ ...binding, facts: { ...binding.facts, calories: 999 } }]))).toThrow('Invalid reviewed facts');
  expect(() => auditChainCoverage(input, batch([{ ...binding, facts: { ...binding.facts, calories: 411 } }]))).toThrow('baseline');
  const first = input.catalog[0]!;
  const { id: _id, brandId: _brandId, createdAt: _created, updatedAt: _updated, retrievedAt: _retrieved, ...expected } = first;
  const quarantine = chainCatalogBatchSchema.parse({ version: 1, reviewedBy: 'Synthetic fixture', changes: [],
    quarantine: [{ slug: 'fixture', canonicalKey: 'plate', expected }] });
  expect(() => auditChainCoverage(input, quarantine)).toThrow('loses 1 existing matches');
});

test('pre-cutover source-less snapshots preserve unmatched variants without inventing IDs', () => {
  const input = snapshot();
  input.sourceIdentity = { sourceItemId: false, retiredAt: false };
  input.items = input.items.filter(i => !i.retiredAt).map(i => ({ ...i, sourceItemId: null }));
  const report = auditChainCoverage(input);
  expect(report.sourceIdentity).toEqual(input.sourceIdentity);
  expect(report.totals.before).toMatchObject({ matched: 0, unmatched: 4 });
  expect(report.unmatchedGroups[0]).toMatchObject({ name: 'Drink', rows: 2,
    variants: [{ sourceItemId: null, rows: 2 }] });
  input.sourceIdentity = { sourceItemId: true, retiredAt: true };
  input.items[1]!.sourceItemId = 'ubereats:one';
  input.items[2]!.sourceItemId = 'ubereats:two';
  expect(auditChainCoverage(input).unmatchedGroups[0]).toMatchObject({ name: 'Drink', rows: 2,
    variants: [{ sourceItemId: 'ubereats:one', rows: 1 }, { sourceItemId: 'ubereats:two', rows: 1 }] });
});

