import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type Brand } from '@prisma/client';
import oldInput from '../../services/chainCatalogs/waba-yoshinoya-2026-09.json';
import qualityInput from '../../services/chainCatalogs/chain-quality-2026-09-input.json';
import observations from '../fixtures/__snapshots__/chain-batch-observations.json';
import wabaUE from '../fixtures/__snapshots__/chain-batch-ue-waba-grill.json';
import yoshiUE from '../fixtures/__snapshots__/chain-batch-ue-yoshinoya.json';
import { chainQualityTruth } from '../fixtures/chain-quality-truth';
import { chainCatalogBatchSchema } from '../../services/chainCatalogBatch';
import { compileChainProductBatch } from '../../services/chainProductBatch';
import { parseStoreV1Response } from '../../services/menuSources/ueApiClient';
import { chainReviewHash } from '../../services/chainCatalog';
import { planChainPilot, applyCatalogPlan, rollbackCatalogPlan, stateHash } from '../../services/chainPilotPlan';
import { applyAprilChainMatch, aprilMenuIdentity, loadChainServing, resolveChainMacros } from '../../services/chainServing';
import { rollbackAprilBatch, type AprilJournal } from '../../services/chainPilotRollback';
import { persistHex } from '../../../../scripts/hex-persist';
import { validateHexInTx } from '../../../../scripts/preload-invariants';
import { getMenuPage } from '../../lib/restaurantMenuService';
import { findNearbyRestaurants, prisma as servingPrisma } from '../../lib/restaurantService';
const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const facts = (r: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null }) => ({ calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG });
suite('manufacturer products and documented default through both real writers', () => {
  const p = new PrismaClient();
  afterAll(async () => { await p.$disconnect(); await servingPrisma.$disconnect(); });
  test('adds 66 April matches and 10 captured UE matches, preserving prior rows and supporting exact rollback', async () => p.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78343218)`;
    const scope = randomUUID(), brands: Brand[] = [], slugs = ['waba-grill', 'yoshinoya'];
    const truth = new Map(chainQualityTruth.map(([slug, name, calories, proteinG, carbsG, fatG]) => [slug + ':' + name, { calories, proteinG, carbsG, fatG }]));
    try {
      for (const slug of slugs) brands.push(await p.brand.create({ data: { slug: scope + slug, displayName: scope + slug, detectionConf: 'high' } }));
      const brandIds = brands.map(b => b.id), oldBatch = chainCatalogBatchSchema.parse(oldInput), batch = compileChainProductBatch(qualityInput);
      for (const input of [oldBatch, batch]) for (const row of input.changes) {
        row.slug = scope + row.slug;
        if (row.expected?.review) row.expected.review.dataHash = chainReviewHash({ id: 'baseline', brandId: brands.find(b => b.slug === row.slug)!.id, ...row.expected, review: row.expected.review }, row.expected.review);
      }
      await p.chainItem.createMany({ data: oldBatch.changes.filter(c => c.expected).map(c => ({ ...c.expected!, brandId: brands.find(b => b.slug === c.slug)!.id, review: c.expected!.review ?? Prisma.DbNull })) });
      const catalogQuery = { where: { brandId: { in: brandIds } }, orderBy: { id: 'asc' as const } };
      await applyCatalogPlan(p, planChainPilot(brands, await p.chainItem.findMany(catalogQuery), oldBatch), oldBatch);
      const beforeCatalog = await p.chainItem.findMany(catalogQuery), oldRuntime = await loadChainServing(p);
      const plan = planChainPilot(brands, beforeCatalog, batch);
      expect(plan.changes).toHaveLength(10);
      const catalogAfter = await applyCatalogPlan(p, plan, batch), runtime = await loadChainServing(p);
      expect(planChainPilot(brands, await p.chainItem.findMany(catalogQuery), batch).changes).toEqual([]);
      for (const old of beforeCatalog) if (old.canonicalKey !== 'chicken-bowl') expect(await p.chainItem.findUnique({ where: { id: old.id } })).toEqual(old);
      const journals: AprilJournal[] = [];
      let beforeCount = 0, afterCount = 0, added = 0;
      const changedKeys = new Set(batch.changes.map(c => c.slug + ':' + c.canonicalKey));
      for (const [index, v] of observations.filter(o => o.count > 0).entries()) {
        const brand = brands.find(b => b.slug === scope + v.slug)!;
        const r = await p.restaurant.create({ data: { storeUuid: scope + index, name: brand.displayName + ' (' + index + ')', brandId: brand.id, address: 'April variant', lat: 34, lng: -118, cuisineTags: [], source: 'ue_feed' } });
        const old = oldRuntime.match(brand.id, v), initial = { calories: old.status === 'matched' ? old.row.calories : 400, proteinG: old.status === 'matched' ? old.row.proteinG : 20, carbsG: old.status === 'matched' ? old.row.carbsG : 50, fatG: old.status === 'matched' ? old.row.fatG : 13 };
        const before = await p.menuItem.create({ data: { restaurantId: r.id, name: v.name, section: v.section, description: v.description, price: 12, photoUrl: 'https://example.com/fixture', dietaryTags: ['fixture'], ...initial,
          macroEstimates: { create: { ...initial, confidence: old.status === 'matched' ? 'HIGH' : 'MEDIUM', source: old.status === 'matched' ? 'official' : 'haiku' } } }, include: { macroEstimates: { orderBy: { id: 'asc' } } } });
        const match = runtime.match(brand.id, aprilMenuIdentity(before));
        if (old.status === 'matched') { beforeCount += v.count; expect(match.status).toBe('matched'); }
        if (match.status === 'matched') afterCount += v.count;
        if (match.status === 'matched' && changedKeys.has(brand.slug + ':' + match.row.canonicalKey)) {
          const expected = truth.get(v.slug + ':' + v.name)!; expect(expected).toBeDefined();
          const after = await applyAprilChainMatch(p, before, match.row); journals.push({ before, after });
          expect(facts(after)).toEqual(expected);
          for (const k of ['id', 'restaurantId', 'name', 'section', 'description', 'price', 'photoUrl', 'dietaryTags', 'createdAt'] as const) expect(after[k]).toEqual(before[k]);
          if (old.status !== 'matched') { added += v.count; expect(after.macroEstimates.find(e => e.source === 'haiku')).toEqual(before.macroEstimates[0]); }
          const detail = await getMenuPage(p, r.id, { targets: expected, selectedItemId: after.id, limit: 1 });
          expect(detail!.menuItems[0]!.macros).toMatchObject({ ...expected, confidence: 'HIGH' });
          if (v.name === 'Chicken Bowl' && v.section === 'Rice Bowls') {
            const search = await findNearbyRestaurants({ lat: 34, lng: -118, radiusMiles: .1, targets: expected, query: r.name, limit: 200 });
            expect(search.data.find(result => result.id === r.id)?.bestMatch).toMatchObject({ menuItemId: after.id, ...expected, confidence: 'HIGH' });
          }
        } else {
          expect(match).toEqual(old);
          expect(await p.menuItem.findUnique({ where: { id: before.id }, include: { macroEstimates: { orderBy: { id: 'asc' } } } })).toEqual(before);
        }
      }
      expect({ beforeCount, afterCount, added }).toEqual({ beforeCount: 592, afterCount: 658, added: 66 });
      for (const [index, raw] of [wabaUE, yoshiUE].entries()) {
        const brand = brands[index]!, items = parseStoreV1Response(raw)!.items, slug = slugs[index]!;
        const r = await p.restaurant.create({ data: { storeUuid: scope + 'ue' + index, name: brand.displayName + ' (New Location)', address: 'UE capture', lat: 34, lng: -118, cuisineTags: [], source: 'ue_feed' } });
        let estimated = 0;
        const macros = await resolveChainMacros(items, runtime.brandId(r), runtime.match, async unresolved => { estimated = unresolved.length; return unresolved.map(() => ({ calories: 400, proteinG: 20, carbsG: 50, fatG: 13, source: 'haiku', confidence: 'MEDIUM', dietaryTags: [] })); });
        expect([macros.filter(m => m?.source === 'official').length, estimated]).toEqual(index === 0 ? [29, 50] : [33, 39]);
        await persistHex(scope, slug, [{ restaurantId: r.id, brandId: brand.id, menuHash: 'full-captured-menu', items: items.map((item, i) => ({ item, macro: macros[i]! })) }], p, { validateInTx: validateHexInTx });
        const persisted = await p.menuItem.findMany({ where: { restaurantId: r.id }, include: { macroEstimates: true } });
        expect(persisted).toHaveLength(items.length);
        for (const [i, item] of items.entries()) {
          const out = persisted.find(o => o.name === item.name)!;
          expect(facts(out)).toEqual(facts(macros[i]!));
          const expected = truth.get(slug + ':' + item.name);
          if (expected) { expect(facts(out)).toEqual(expected); expect(out.macroEstimates[0]!.source).toBe('official'); }
        }
      }
      await rollbackAprilBatch(p, journals);
      for (const journal of journals) expect(stateHash(await p.menuItem.findUnique({ where: { id: journal.before.id }, include: { macroEstimates: { orderBy: { id: 'asc' } } } }))).toBe(stateHash(journal.before));
      await p.restaurant.deleteMany({ where: { storeUuid: { startsWith: scope + 'ue' } } });
      await rollbackCatalogPlan(p, plan, catalogAfter);
      expect(stateHash(await p.chainItem.findMany(catalogQuery))).toBe(stateHash(beforeCatalog));
    } finally {
      await p.restaurant.deleteMany({ where: { storeUuid: { startsWith: scope } } });
      await p.chainItem.deleteMany({ where: { brandId: { in: brands.map(b => b.id) } } });
      await p.brand.deleteMany({ where: { id: { in: brands.map(b => b.id) } } });
      await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    }
  }, { timeout: 120_000, maxWait: 120_000 }), 125_000);
});
