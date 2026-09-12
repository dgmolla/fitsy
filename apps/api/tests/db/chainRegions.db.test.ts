import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { approvedChainRow, chainReviewHash } from '../../services/chainCatalog';
import { applyAprilChainMatch, loadChainServing, resolveChainMacros } from '../../services/chainServing';
import { applyAprilChainBatch, restoreAprilChainBatch } from '../../services/chainAprilBatch';
import { stateHash } from '../../services/chainPilotPlan';
import { getMenuPage } from '../../lib/restaurantMenuService';
import { persistHex } from '../../../../scripts/hex-persist';
import { persistItems } from '../../../../scripts/pipeline-utils';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
suite('regional official nutrition through the real writer and served menu', () => {
  const p = new PrismaClient(), scope = randomUUID();
  afterAll(async () => { await p.$disconnect(); });
  test('a California-only fact reaches California menus while Ohio keeps its estimate', async () => {
    const brand = await p.brand.create({ data: { slug: scope, displayName: scope, detectionConf: 'high' } });
    try {
      const item = { name: 'Plain Croissant', section: 'Bakery', description: 'One butter croissant' };
      const row = await p.chainItem.create({ data: { brandId: brand.id, canonicalKey: 'ca/croissant',
        servingSize: 'One croissant', calories: 300, proteinG: 6, carbsG: 33, fatG: 16,
        source: 'official', confidence: 'HIGH', officialUrl: 'https://example.com/california-nutrition.pdf' } });
      const review = { version: 1 as const, sourceHash: 'a'.repeat(64), reviewedBy: 'Regional regression fixture',
        locator: 'California food guide, croissant row', aliases: [item], usStates: ['CA'] };
      const approved = approvedChainRow(await p.chainItem.update({ where: { id: row.id }, data: { review: { ...review, dataHash: chainReviewHash(row, review) } } }))!;
      const runtime = await loadChainServing(p);
      const observed: { location: string; calories: number | null; confidence: string | undefined }[] = [];
      for (const [location, lat, lng] of [['California', 34.0522, -118.2437], ['Ohio', 41.4993, -81.6944]] as const) {
        const restaurant = await p.restaurant.create({ data: { storeUuid: scope + location, name: brand.displayName,
          ...(location === 'Ohio' ? { brandId: brand.id } : {}), address: location, lat, lng, source: 'ue_feed', cuisineTags: [] } });
        const macros = await resolveChainMacros([item], runtime.brandId(restaurant), runtime.match,
          async items => items.map(() => ({ calories: 400, proteinG: 8, carbsG: 44, fatG: 21, confidence: 'MEDIUM' as const, source: 'haiku', dietaryTags: [] })), restaurant);
        await persistHex(scope, location, [{ restaurantId: restaurant.id, brandId: brand.id,
          menuHash: scope + location, items: [{ item, macro: macros[0]! }] }], p);
        expect(await p.restaurant.findUniqueOrThrow({ where: { id: restaurant.id } })).toMatchObject({ brandId: brand.id, chainFlag: true });
        const page = await getMenuPage(p, restaurant.id, { limit: 10 });
        const served = page!.menuItems[0]!.macros;
        observed.push({ location, calories: served?.calories ?? null, confidence: served?.confidence });
        if (location === 'California') {
          const include = { macroEstimates: { orderBy: { id: 'asc' as const } } };
          const snapshot = () => p.menuItem.findUniqueOrThrow({ where: { restaurantId_name: { restaurantId: restaurant.id, name: item.name } }, include });
          const original = await snapshot(), pairs = [{ item, macro: macros[0]! }];
          await expect(persistItems(restaurant.id, [{ item, macro: { ...macros[0]!, calories: 301 } }], p)).rejects.toThrow('facts changed');
          expect(stateHash(await snapshot())).toBe(stateHash(original));
          // Stale resolved nutrition cannot cross a state boundary at either writer.
          await p.restaurant.update({ where: { id: restaurant.id }, data: { lat: 41.4993, lng: -81.6944 } });
          await expect(persistHex(scope, 'stale', [{ restaurantId: restaurant.id, brandId: brand.id, menuHash: 'stale', items: pairs }], p)).rejects.toThrow('location changed');
          await expect(persistItems(restaurant.id, pairs, p)).rejects.toThrow('location changed');
          await expect(applyAprilChainMatch(p, original, approved)).rejects.toThrow('binding');
          await expect(applyAprilChainBatch(p, [{ before: original, approved }])).rejects.toThrow('binding');
          expect(stateHash(await snapshot())).toBe(stateHash(original));
          expect(await p.pipelineCompletedHex.count({ where: { runId: scope, hexId: 'stale' } })).toBe(0);
          await p.restaurant.update({ where: { id: restaurant.id }, data: { lat, lng } });
          // Existing menu update adds official facts without losing the estimate or item identity.
          await p.macroEstimate.deleteMany({ where: { menuItemId: original.id } });
          await p.menuItem.update({ where: { id: original.id }, data: { calories: 400, proteinG: 8, carbsG: 44, fatG: 21,
            macroEstimates: { create: { calories: 400, proteinG: 8, carbsG: 44, fatG: 21, confidence: 'MEDIUM', source: 'haiku' } } } });
          const before = await snapshot(), [after] = await applyAprilChainBatch(p, [{ before, approved }]);
          expect(after).toMatchObject({ id: original.id, calories: 300 });
          expect(after!.macroEstimates.find(e => e.source === 'haiku')).toEqual(before.macroEstimates[0]);
          expect(stateHash((await applyAprilChainBatch(p, [{ before: after!, approved }]))[0])).toBe(stateHash(after));
          await restoreAprilChainBatch(p, [{ before, after: after! }]);
          expect(stateHash(await snapshot())).toBe(stateHash(before));
          const single = await applyAprilChainMatch(p, before, approved);
          expect(single.calories).toBe(300);
          await restoreAprilChainBatch(p, [{ before, after: single }]);
          expect(stateHash(await snapshot())).toBe(stateHash(before));
          // A catalog change after resolution rejects before mutating the current menu.
          await p.chainItem.update({ where: { id: row.id }, data: { calories: 301 } });
          await expect(persistItems(restaurant.id, pairs, p)).rejects.toThrow('binding');
          expect(stateHash(await snapshot())).toBe(stateHash(before));
          await p.chainItem.update({ where: { id: row.id }, data: { calories: 300 } });
        }
      }
      expect(observed).toEqual([{ location: 'California', calories: 300, confidence: 'HIGH' },
        { location: 'Ohio', calories: 400, confidence: 'MEDIUM' }]);
    } finally {
      await p.restaurant.deleteMany({ where: { storeUuid: { startsWith: scope } } });
      await p.chainItem.deleteMany({ where: { brandId: brand.id } });
      await p.brand.delete({ where: { id: brand.id } });
      await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    }
  });
});
