import { chainCoverageSnapshotSchema, LA_CHAIN_BOUNDS } from '../../services/chainCoverage';
import { chainCatalogBatchSchema } from '../../services/chainCatalogBatch';
import { planChainPilot } from '../../services/chainPilotPlan';

export const coverageFixtureDate = new Date('2026-10-24T12:00:00.000Z');
const brand = { id: 'fixture', slug: 'fixture', displayName: 'Fixture', aliases: [], locationCount: 2, menuKind: 'restaurant',
  bestPair: null, distinctive: false, detectionConf: 'high', macroSource: null, officialUrl: null, createdAt: coverageFixtureDate, updatedAt: coverageFixtureDate };
export const coverageBindingFixture = { slug: 'fixture', canonicalKey: 'plate', expected: null,
  facts: { calories: 410, proteinG: 20, carbsG: 50, fatG: 10, servingSize: '1 synthetic plate' },
  source: { url: 'https://example.com/fixture-only', sha256: 'a'.repeat(64) }, locator: 'Synthetic fixture',
  aliases: [{ name: 'Plate', section: 'Entrees', sourceItemId: 'ubereats:plate' }] };
export const coverageBatchFixture = (changes = [coverageBindingFixture]) => chainCatalogBatchSchema.parse({ version: 1, reviewedBy: 'Synthetic fixture', changes, quarantine: [] });
export function coverageSnapshotFixture() {
  const current = planChainPilot([brand], [], coverageBatchFixture()).changes[0]!.desired;
  const menu = { restaurantId: 'r', name: 'Plate', sourceItemId: 'ubereats:plate', section: 'Entrees', description: null,
    retiredAt: null, calories: 1, proteinG: 0, carbsG: 0, fatG: 0, macroEstimates: [] };
  return chainCoverageSnapshotSchema.parse({ version: 1, origin: 'fixture', capturedAt: coverageFixtureDate.toISOString(), targetHash: 'fixture', runtime: 'fixture', readOnly: true,
    sourceIdentity: { sourceItemId: true, retiredAt: true },
    bounds: LA_CHAIN_BOUNDS, brands: [brand, { ...brand, id: 'kfc', slug: 'kfc', displayName: 'KFC' }],
    catalog: [{ ...current, id: 'c', createdAt: coverageFixtureDate, updatedAt: coverageFixtureDate, retrievedAt: coverageFixtureDate }],
    restaurants: [{ id: 'r', name: 'Fixture (LA)', brandId: brand.id, lat: 34, lng: -118 },
      { id: 'kfc-r', name: 'KFC (LA)', brandId: 'kfc', lat: 34, lng: -118 }],
    items: [{ ...menu, id: 'one' }, { ...menu, id: 'two', name: 'Drink', sourceItemId: 'ubereats:drink' },
      { ...menu, id: 'three', name: 'Drink', sourceItemId: 'ubereats:drink' },
      { ...menu, id: 'kfc-item', restaurantId: 'kfc-r', name: 'Unknown serving' },
      { ...menu, id: 'retired', retiredAt: coverageFixtureDate }] });
}

