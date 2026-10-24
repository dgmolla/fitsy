import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { approvedChainRow, chainReviewHash } from '../../services/chainCatalog';
import { loadChainServing, chainMenuResolver, applyAprilChainMatch } from '../../services/chainServing';
import { applyAprilChainBatch, restoreAprilChainBatch } from '../../services/chainAprilBatch';
import { stateHash, planChainPilot, applyCatalogPlan, rollbackCatalogPlan } from '../../services/chainPilotPlan';
import { getMenuPage } from '../../lib/restaurantMenuService';
import { persistItems } from '../../../../scripts/pipeline-utils';
import { chainCatalogBatchSchema } from '../../services/chainCatalogBatch';
import { persistHex } from '../../../../scripts/hex-persist';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
suite('official store scope through April and new hex persistence', () => {
 const p = new PrismaClient(), scope = randomUUID();
 afterAll(async () => { await p.$disconnect(); });
 test('an LA source cannot overwrite a same-state Bay Area serving', async () => {
  const brand = await p.brand.create({ data: { slug: scope, displayName: scope, detectionConf: 'high' } });
  try {
   const item = { name: 'Butter Croissant', section: 'Bakery', description: 'One croissant' };
   const row = await p.chainItem.create({ data: { brandId: brand.id, canonicalKey: 'la/croissant', servingSize: 'One croissant',
    calories: 270, fatG: 15, carbsG: 29, proteinG: 5, source: 'official', confidence: 'HIGH', officialUrl: 'https://example.com/la.pdf' } });
   const review = { version: 1 as const, sourceHash: 'a'.repeat(64), reviewedBy: 'Store scope regression fixture',
    locator: 'LA croissant', aliases: [item], usStates: ['CA'], storeScope: {
     directory: { url: 'https://example.com/stores', sha256: 'b'.repeat(64), locator: 'Reviewed directory' },
     stores: [{ storeId: 'hollywood', lat: 34.0976798, lng: -118.3299269, radiusMeters: 100,
      association: { url: 'https://example.com/hollywood/food', sha256: 'c'.repeat(64), locator: 'LA guide link' } }],
    } };
   const approved = approvedChainRow(await p.chainItem.update({ where: { id: row.id }, data: { review: { ...review, dataHash: chainReviewHash(row, review) } } }))!;
   expect(approved).not.toBeNull();
   const runtime = await loadChainServing(p);
   for (const [location, lat, lng, expected] of [['LA', 34.09768, -118.32993, 270], ['Bay', 37.775535, -122.393421, 400]] as const) {
    const restaurant = await p.restaurant.create({ data: { storeUuid: `${scope}-${location}`, name: brand.displayName,
     address: location, lat, lng, source: 'ue_feed', cuisineTags: [] } });
    const macros = await chainMenuResolver({ ...restaurant, storeUuid: restaurant.storeUuid! }, runtime).resolveMacros([item],
     async items => items.map(() => ({ calories: 400, fatG: 20, carbsG: 45, proteinG: 10, source: 'haiku', confidence: 'MEDIUM' as const, dietaryTags: [] })));
    await persistHex(scope, location, [{ restaurantId: restaurant.id, brandId: brand.id, menuHash: location, items: [{ item, macro: macros[0]! }] }], p);
    expect((await getMenuPage(p, restaurant.id, { limit: 10 }))!.menuItems[0]!.macros!.calories).toBe(expected);
    const snapshot = () => p.menuItem.findFirstOrThrow({ where: { restaurantId: restaurant.id }, include: { macroEstimates: { orderBy: { id: 'asc' as const } } } });
    const before = await snapshot();
    if (location === 'Bay') {
     await expect(applyAprilChainBatch(p, [{ before, approved }])).rejects.toThrow('binding');
     expect(stateHash(await snapshot())).toBe(stateHash(before));
    } else {
     await p.macroEstimate.deleteMany({ where: { menuItemId: before.id } });
     await p.menuItem.update({ where: { id: before.id }, data: { calories: 400, fatG: 20, carbsG: 45, proteinG: 10,
      macroEstimates: { create: { calories: 400, fatG: 20, carbsG: 45, proteinG: 10, source: 'haiku', confidence: 'MEDIUM' } } } });
     const original = await snapshot(), [after] = await applyAprilChainBatch(p, [{ before: original, approved }]);
     expect(after).toMatchObject({ id: original.id, calories: 270 });
     expect(after!.macroEstimates.find(e => e.source === 'haiku')).toEqual(original.macroEstimates[0]);
     expect(stateHash((await applyAprilChainBatch(p, [{ before: after!, approved }]))[0])).toBe(stateHash(after));
     await restoreAprilChainBatch(p, [{ before: original, after: after! }]);
     expect(stateHash(await snapshot())).toBe(stateHash(original));
     await p.restaurant.update({ where: { id: restaurant.id }, data: { lat: 37.775535, lng: -122.393421 } });
     const pairs = [{ item, macro: macros[0]! }];
     await expect(persistItems(restaurant.id, pairs, p)).rejects.toThrow('location changed');
     await expect(persistHex(scope, 'stale-store', [{ restaurantId: restaurant.id, brandId: brand.id, menuHash: 'stale', items: pairs }], p)).rejects.toThrow('location changed');
     await expect(applyAprilChainMatch(p, original, approved)).rejects.toThrow('binding');
     await expect(applyAprilChainBatch(p, [{ before: original, approved }])).rejects.toThrow('binding');
     expect(stateHash(await snapshot())).toBe(stateHash(original));
     expect(await p.pipelineCompletedHex.count({ where: { runId: scope, hexId: 'stale-store' } })).toBe(0);
    }
   }
  } finally {
   await p.restaurant.deleteMany({ where: { storeUuid: { startsWith: scope } } });
   await p.chainItem.deleteMany({ where: { brandId: brand.id } });
   await p.brand.delete({ where: { id: brand.id } });
   await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
  }
 }, 60_000);
 test('catalog planning and apply preserve scope, reorder idempotently, and roll back exactly', async () => {
  const brand = await p.brand.create({ data: { slug: `${scope}-catalog`, displayName: `${scope}-catalog`, detectionConf: 'high' } });
  try {
   const evidence = { url: 'https://example.com/stores', sha256: 'c'.repeat(64), locator: 'Reviewed directory and source association' };
   const batch = chainCatalogBatchSchema.parse({ version: 1, reviewedBy: 'Store-scope fixture', quarantine: [], changes: [{ slug: brand.slug,
    canonicalKey: 'croissant', expected: null, facts: { calories: 270, fatG: 15, carbsG: 29, proteinG: 5, servingSize: 'One croissant' },
    source: { url: 'https://example.com/la.pdf', sha256: 'a'.repeat(64) }, locator: 'Croissant', aliases: [{ name: 'Butter Croissant' }],
    storeScope: { directory: evidence, stores: [
     { storeId: 'hollywood', lat: 34.09768, lng: -118.32993, radiusMeters: 100, association: evidence },
     { storeId: 'berry', lat: 37.775535, lng: -122.393421, radiusMeters: 100, association: evidence },
    ] } }] });
   const plan = planChainPilot([brand], [], batch), after = await applyCatalogPlan(p, plan, batch);
   expect(approvedChainRow(after[0]!)!.review.storeScope).toEqual(batch.changes[0]!.storeScope);
   expect(planChainPilot([brand], after, batch).changes).toEqual([]);
   batch.changes[0]!.storeScope!.stores.reverse();
   expect(planChainPilot([brand], after, batch).changes).toEqual([]);
   batch.changes[0]!.storeScope!.stores[0]!.radiusMeters = 50;
   expect(() => planChainPilot([brand], after, batch)).toThrow('audited baseline');
   await rollbackCatalogPlan(p, plan, after);
   expect(await p.chainItem.count({ where: { brandId: brand.id } })).toBe(0);
  } finally {
   await p.chainItem.deleteMany({ where: { brandId: brand.id } });
   await p.brand.delete({ where: { id: brand.id } });
  }
 });
});
