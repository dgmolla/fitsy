import type { Prisma } from '@prisma/client';
import { capturedChainPilot } from '../tests/fixtures/chain-pilot';
import { parseStoreV1Response } from './menuSources/ueApiClient';
import { approvedChainRow, chainReviewHash } from './chainCatalog';
import { officialMacro } from './chainServing';
import { invalidateStaleChainBindings } from './chainWriteGuard';

const fixture = capturedChainPilot[0]!, item = parseStoreV1Response(fixture.ue)!.items[0]!;
function database() {
  const brand = { id: 'brand', displayName: 'WaBa Grill', slug: 'waba-grill', aliases: [], detectionConf: 'high', menuKind: 'restaurant' };
  const facts = { id: 'row', brandId: brand.id, canonicalKey: 'chicken-plate', ...fixture.official,
    source: 'official', confidence: 'HIGH', officialUrl: fixture.source.url };
  const review = { version: 1 as const, sourceHash: fixture.source.sha256, locator: fixture.source.locator,
    reviewedBy: 'independent PDF fixture', aliases: [{ name: item.name, section: item.section!, description: item.description! }] };
  const row = { ...facts, review: { ...review, dataHash: chainReviewHash({ ...facts, review: null }, review) } };
  const macro = officialMacro(approvedChainRow(row)!, item);
  const estimate = { id: 'estimate', menuItemId: 'menu-item', ...macro };
  const tx = { brand: { findMany: jest.fn(async () => [brand]) }, chainItem: { findMany: jest.fn(async () => [row]) },
    restaurant: { findMany: jest.fn(async () => [{ id: 'restaurant', name: 'WaBa Grill - Los Angeles', brandId: brand.id, lat: 34.05, lng: -118.25 }]) },
    macroEstimate: { findMany: jest.fn(async () => [estimate]), deleteMany: jest.fn(async () => ({ count: 1 })) } };
  return { tx, row, estimate, input: { id: estimate.menuItemId, restaurantId: 'restaurant', item, source: 'jev' } };
}

test('a non-official write preserves the exact official link and facts', async () => {
  const { tx, input } = database();
  await invalidateStaleChainBindings(tx as unknown as Prisma.TransactionClient, [input]);
  expect(tx.macroEstimate.deleteMany).not.toHaveBeenCalled();
});
test.each(['name', 'description', 'sourceItemId'] as const)('a changed %s invalidates the old serving', async key => {
  const { tx, input } = database();
  await invalidateStaleChainBindings(tx as unknown as Prisma.TransactionClient, [{ ...input, item: { ...item, [key]: 'changed-serving' } }]);
  expect(tx.macroEstimate.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['estimate'] } } });
});
test('revoked catalog approval cannot remain the winning official source', async () => {
  const { tx, input, row } = database();
  tx.chainItem.findMany.mockResolvedValue([{ ...row, review: { ...row.review, dataHash: '0'.repeat(64) } }]);
  await invalidateStaleChainBindings(tx as unknown as Prisma.TransactionClient, [input]);
  expect(tx.macroEstimate.deleteMany).toHaveBeenCalledTimes(1);
});
test('changed official facts are not retained over a current estimate', async () => {
  const { tx, input, estimate } = database();
  tx.macroEstimate.findMany.mockResolvedValue([{ ...estimate, calories: 1 }]);
  await invalidateStaleChainBindings(tx as unknown as Prisma.TransactionClient, [input]);
  expect(tx.macroEstimate.deleteMany).toHaveBeenCalledTimes(1);
});
test('official upserts do not enter the non-official invalidation path', async () => {
  const { tx, input } = database();
  await invalidateStaleChainBindings(tx as unknown as Prisma.TransactionClient, [{ ...input, source: 'official' }]);
  expect(tx.macroEstimate.findMany).not.toHaveBeenCalled();
});
