import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type Brand } from '@prisma/client';
import manifest from '../../services/chainCatalogs/waba-yoshinoya-2026-09.json';
import observations from '../fixtures/__snapshots__/chain-batch-observations.json';
import wabaUE from '../fixtures/__snapshots__/chain-batch-ue-waba-grill.json';
import yoshiUE from '../fixtures/__snapshots__/chain-batch-ue-yoshinoya.json';
import { chainCatalogBatchSchema } from '../../services/chainCatalogBatch';
import { planChainPilot, applyCatalogPlan, rollbackCatalogPlan, stateHash } from '../../services/chainPilotPlan';
import { applyAprilChainMatch, aprilMenuIdentity, loadChainServing, resolveChainMacros } from '../../services/chainServing';
import { chainBatchTruth, chainBindingTruth } from '../fixtures/chain-batch-truth';
import { parseStoreV1Response } from '../../services/menuSources/ueApiClient';
import { persistHex } from '../../../../scripts/hex-persist';
import { validateHexInTx } from '../../../../scripts/preload-invariants';
import { rollbackAprilBatch, type AprilJournal } from '../../services/chainPilotRollback';
import { chainMenuFingerprint } from '../../services/chainCatalog';
import { getMenuPage } from '../../lib/restaurantMenuService';
const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const facts = (r: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null }) => ({ calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG });
suite('full two-chain catalog replay', () => {
  const p = new PrismaClient(), scope = randomUUID(), brandIds: string[] = [];
  afterAll(async () => { await p.$disconnect(); });
  test('April variants and complete captured UE menus use the same reviewed servings, with explicit abstentions', async () => {
    const batch = chainCatalogBatchSchema.parse(manifest), slugs = ['waba-grill', 'yoshinoya'];
    const truth = new Map(chainBatchTruth.map(([slug, key, calories, proteinG, carbsG, fatG]) => [slug + ':' + key, { calories, proteinG, carbsG, fatG }]));
    const bindings = new Map(chainBindingTruth.map(([slug, key, item]) => [slug + ':' + chainMenuFingerprint(item), key]));
    const brands: Brand[] = [];
    try {
      for (const slug of slugs) {
        const b = await p.brand.create({ data: { slug: scope + slug, displayName: scope + slug, detectionConf: 'high' } });
        brands.push(b); brandIds.push(b.id);
      }
      for (const row of batch.changes) row.slug = scope + row.slug;
      await p.chainItem.createMany({ data: batch.changes.filter(r => r.expected).map(r => ({ ...r.expected!, brandId: brands.find(b => b.slug === r.slug)!.id, review: r.expected!.review ?? Prisma.DbNull })) });
      const beforeCatalog = await p.chainItem.findMany({ where: { brandId: { in: brandIds } } });
      const catalogPlan = planChainPilot(brands, beforeCatalog, batch);
      const catalogAfter = await applyCatalogPlan(p, catalogPlan, batch);
      const stored = await p.chainItem.findMany({ where: { brandId: { in: brandIds } } });
      expect(planChainPilot(brands, stored, batch).changes).toEqual([]);
      const runtime = await loadChainServing(p);
      const variants = observations.filter(o => o.count > 0).map(o => ({ ...o, restaurantId: randomUUID(), id: randomUUID() }));
      await p.restaurant.createMany({ data: variants.map(v => ({ id: v.restaurantId, storeUuid: scope + v.id, name: scope + v.slug, brandId: brands.find(b => b.slug === scope + v.slug)!.id, address: 'Captured variant', lat: 34, lng: -118, cuisineTags: [], source: 'ue_feed' })) });
      await p.menuItem.createMany({ data: variants.map(v => ({ id: v.id, restaurantId: v.restaurantId, name: v.name, section: v.section, description: v.description, price: 12, photoUrl: 'https://example.com/menu', dietaryTags: ['fixture'], calories: 400, proteinG: 20, carbsG: 50, fatG: 13 })) });
      await p.macroEstimate.createMany({ data: variants.map(v => ({ menuItemId: v.id, calories: 400, proteinG: 20, carbsG: 50, fatG: 13, confidence: 'MEDIUM', source: 'haiku' })) });
      const before = await p.menuItem.findMany({ where: { id: { in: variants.map(v => v.id) } }, include: { macroEstimates: { orderBy: { id: 'asc' } } } });
      const journals: AprilJournal[] = [];
      const aprilCounts = { 'waba-grill': 0, yoshinoya: 0 };
      const mainCounts = { 'waba-grill': 0, yoshinoya: 0 };
      for (const item of before) {
        const v = variants.find(v => v.id === item.id)!, brand = brands.find(b => b.slug === scope + v.slug)!;
        const result = runtime.match(brand.id, aprilMenuIdentity(item));
        if (result.status === 'matched') {
          const expected = truth.get(v.slug + ':' + bindings.get(v.slug + ':' + chainMenuFingerprint(v)))!; expect(expected).toBeDefined();
          const after = await applyAprilChainMatch(p, item, result.row); journals.push({ before: item, after });
          expect(after).toMatchObject(expected);
          for (const key of ['id', 'name', 'section', 'description', 'price', 'photoUrl', 'dietaryTags', 'createdAt'] as const) expect(after[key]).toEqual(item[key]);
          expect(after.macroEstimates.find(e => e.source === 'haiku')).toEqual(item.macroEstimates[0]);
          const detail = await getMenuPage(p, item.restaurantId, { targets: expected, selectedItemId: item.id, limit: 1 });
          expect(detail!.menuItems[0]!.macros).toMatchObject({ ...expected, confidence: 'HIGH' });
          aprilCounts[v.slug as keyof typeof aprilCounts] += v.count;
          if (/bowl|plate|salad/.test(result.row.canonicalKey)) mainCounts[v.slug as keyof typeof mainCounts] += v.count;
        } else {
          const after = await p.menuItem.findUniqueOrThrow({ where: { id: item.id }, include: { macroEstimates: { orderBy: { id: 'asc' } } } });
          expect(stateHash(after)).toBe(stateHash(item));
        }
      }
      expect(aprilCounts).toEqual({ 'waba-grill': 387, yoshinoya: 223 });
      expect(mainCounts).toEqual({ 'waba-grill': 330, yoshinoya: 66 });
      for (const [index, raw] of [wabaUE, yoshiUE].entries()) {
        const slug = slugs[index]!, brand = brands[index]!, items = parseStoreV1Response(raw)!.items;
        const r = await p.restaurant.create({ data: { storeUuid: scope + 'new-' + slug, name: brand.displayName + ' (New Location)', address: 'New hex fixture', lat: 34, lng: -118, cuisineTags: [], source: 'ue_feed' } });
        expect(runtime.brandId(r)).toBe(brand.id);
        let fallbackCount = 0;
        const macros = await resolveChainMacros(items, runtime.brandId(r), runtime.match, async unresolved => {
          fallbackCount = unresolved.length;
          return unresolved.map(() => ({ calories: 400, proteinG: 20, carbsG: 50, fatG: 13, confidence: 'MEDIUM', source: 'haiku', dietaryTags: [] }));
        });
        const officialCount = macros.filter(m => m?.source === 'official').length;
        const mains = items.filter(i => { const r = runtime.match(brand.id, i); return r.status === 'matched' && /bowl|plate|salad/.test(r.row.canonicalKey); });
        expect(mains).toHaveLength(index === 0 ? 17 : 2);
        expect([items.length, officialCount, fallbackCount]).toEqual(index === 0 ? [79, 20, 59] : [72, 32, 40]);
        await persistHex(scope, slug, [{ restaurantId: r.id, brandId: brand.id, menuHash: 'full-captured-menu', items: items.map((item, i) => ({ item, macro: macros[i]! })) }], p, { validateInTx: validateHexInTx });
        const menu = await p.menuItem.findMany({ where: { restaurantId: r.id }, include: { macroEstimates: true } });
        expect(menu).toHaveLength(items.length);
        for (const input of items) {
          const output = menu.find(m => m.name === input.name)!, result = runtime.match(brand.id, input);
          if (result.status === 'matched') {
            const expected = truth.get(slug + ':' + bindings.get(slug + ':' + chainMenuFingerprint(input)))!;
            expect(facts(output)).toEqual(expected);
            expect(output.macroEstimates).toEqual([expect.objectContaining({ ...expected, source: 'official', confidence: 'HIGH' })]);
          } else expect(output.macroEstimates.map(e => e.source)).toEqual(['haiku']);
        }
        expect(runtime.match(brand.id, { ...items.find(i => runtime.match(brand.id, i).status === 'matched')!, calorieRange: [10, 2000] }).status).toBe('unmatched');
      }
      await rollbackAprilBatch(p, journals);
      const restored = await p.menuItem.findMany({ where: { id: { in: variants.map(v => v.id) } }, include: { macroEstimates: { orderBy: { id: 'asc' } } } });
      expect(stateHash(restored.sort((a, b) => a.id.localeCompare(b.id)))).toBe(stateHash(before.sort((a, b) => a.id.localeCompare(b.id))));
      await p.restaurant.deleteMany({ where: { storeUuid: { in: slugs.map(s => scope + 'new-' + s) } } });
      await rollbackCatalogPlan(p, catalogPlan, catalogAfter);
      const restoredCatalog = await p.chainItem.findMany({ where: { brandId: { in: brandIds } } });
      expect(stateHash(restoredCatalog.sort((a, b) => a.id.localeCompare(b.id)))).toBe(stateHash(beforeCatalog.sort((a, b) => a.id.localeCompare(b.id))));
    } finally {
      await p.restaurant.deleteMany({ where: { OR: [{ brandId: { in: brandIds } }, { storeUuid: { startsWith: scope } }] } });
      await p.chainItem.deleteMany({ where: { brandId: { in: brandIds } } });
      await p.brand.deleteMany({ where: { id: { in: brandIds } } });
      await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    }
  }, 120_000);
});
