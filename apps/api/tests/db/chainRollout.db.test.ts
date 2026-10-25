import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import capture from '../fixtures/menu-source-identity.json';
import { isLocalDatabaseHost } from '../fixtures/localDatabaseHost';
import { parseStoreV1Response } from '../../services/menuSources/ueApiClient';
import { chainCatalogBatchSchema } from '../../services/chainCatalogBatch';
import { applyCatalogPlan, planChainPilot } from '../../services/chainPilotPlan';
import { applyAprilChainMatch, aprilMenuIdentity, loadChainServing, resolveChainMacros } from '../../services/chainServing';
import { applyAprilChainBatch } from '../../services/chainAprilBatch';
import { auditChainCoverage, readChainCoverageSnapshot } from '../../services/chainCoverage';
import { persistHex } from '../../../../scripts/hex-persist';
import { validateHexInTx } from '../../../../scripts/preload-invariants';

const suite = isLocalDatabaseHost(process.env['POSTGRES_PRISMA_URL']) ? describe : describe.skip;
suite('source-bound allulose servings through real persistence and a read-only census', () => {
  const p = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  const queries: string[] = [];
  p.$on('query', event => queries.push(event.query));
  const scope = 'rollout-fixture-' + randomUUID();
  afterAll(async () => {
    await p.restaurant.deleteMany({ where: { source: scope } });
    await p.chainItem.deleteMany({ where: { brand: { slug: { startsWith: scope } } } });
    await p.brand.deleteMany({ where: { slug: { startsWith: scope } } });
    await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    await p.$disconnect();
  });
  test.each(['single', 'batch', 'ue'])('%s writer preserves distinct IDs, total carbs and reviewed energy evidence', async writer => {
    const slug = `${scope}-${writer}`;
    const brand = await p.brand.create({ data: { slug, displayName: slug, detectionConf: 'high' } });
    const restaurant = await p.restaurant.create({ data: { storeUuid: randomUUID(), name: slug, brandId: brand.id,
      source: scope, address: 'Synthetic local fixture', lat: 34, lng: -118, cuisineTags: [], chainFlag: true } });
    const items = parseStoreV1Response(capture)!.items;
    const batch = chainCatalogBatchSchema.parse({ version: 1, reviewedBy: 'Synthetic regression only', quarantine: [],
      changes: items.map((item, i) => ({ slug, canonicalKey: `fixture-${i}`, expected: null,
        facts: { calories: i ? 48 : 12, proteinG: 0, carbsG: i ? 120 : 30, fatG: 0, servingSize: `Synthetic serving ${i}` },
        allulose: { grams: i ? 120 : 30, locator: 'Synthetic allulose line' },
        aliases: [{ name: item.name, section: item.section, description: item.description, sourceItemId: item.sourceItemId }],
        source: { url: 'https://example.com/fixture-only', sha256: 'a'.repeat(64) }, locator: 'Synthetic data, not Panini nutrition' })) });
    await applyCatalogPlan(p, planChainPilot([brand], [], batch), batch);
    const runtime = await loadChainServing(p);
    if (writer === 'ue') {
      const macros = await resolveChainMacros(items, brand.id, runtime.match, async () => { throw new Error('Approved fixture must skip estimation'); }, restaurant);
      await persistHex(scope, writer, [{ restaurantId: restaurant.id, brandId: brand.id, menuHash: 'fixture',
        items: items.map((item, i) => ({ item, macro: macros[i]! })) }], p, { validateInTx: validateHexInTx });
    } else {
      const entries = [];
      for (const item of items) {
        const before = await p.menuItem.create({ data: { restaurantId: restaurant.id, name: item.name,
          sourceItemId: item.sourceItemId!, section: item.section ?? null, description: item.description ?? null },
          include: { macroEstimates: { orderBy: { id: 'asc' } } } });
        const result = runtime.match(brand.id, aprilMenuIdentity(before), restaurant);
        if (result.status !== 'matched') throw new Error('Synthetic serving did not match');
        entries.push({ before, approved: result.row });
      }
      if (writer === 'batch') await applyAprilChainBatch(p, entries);
      else for (const entry of entries) await applyAprilChainMatch(p, entry.before, entry.approved);
      expect((await p.menuItem.findMany({ where: { restaurantId: restaurant.id } })).map(i => i.id).sort())
        .toEqual(entries.map(e => e.before.id).sort());
      const current = await p.menuItem.findUniqueOrThrow({ where: { id: entries[0]!.before.id },
        include: { macroEstimates: { orderBy: { id: 'asc' } } } });
      // A raw source-ID change can preserve updatedAt; the locked identity comparison still rejects it.
      await p.$executeRaw`UPDATE "MenuItem" SET "sourceItemId" = 'ubereats:changed-serving' WHERE id = ${current.id}`;
      const stale = { before: current, approved: entries[0]!.approved };
      if (writer === 'batch') await expect(applyAprilChainBatch(p, [stale])).rejects.toThrow('April item changed');
      else await expect(applyAprilChainMatch(p, stale.before, stale.approved)).rejects.toThrow('April item changed');
      await p.$executeRaw`UPDATE "MenuItem" SET "sourceItemId" = ${current.sourceItemId} WHERE id = ${current.id}`;
    }
    const stored = await p.menuItem.findMany({ where: { restaurantId: restaurant.id }, orderBy: { calories: 'asc' } });
    expect(stored.map(i => [i.calories, i.carbsG])).toEqual([[12, 30], [48, 120]]);
    expect(new Set(stored.map(i => i.sourceItemId)).size).toBe(2);
    queries.length = 0;
    const snapshot = await readChainCoverageSnapshot(p, { origin: 'fixture', targetHash: 'local-fixture', runtime: 'test' });
    expect(queries.findIndex(q => q.includes('SET TRANSACTION READ ONLY'))).toBeGreaterThanOrEqual(0);
    expect(queries.findIndex(q => /^SELECT/i.test(q))).toBeGreaterThan(queries.findIndex(q => q.includes('SET TRANSACTION READ ONLY')));
    expect(queries.some(q => /\b(?:INSERT INTO|UPDATE "|DELETE FROM)\b/i.test(q))).toBe(false);
    const coverage = auditChainCoverage(snapshot).chains.find(c => c.slug === slug)!;
    expect(coverage.before).toMatchObject({ items: 2, matched: 2, unmatched: 0, servedOfficial: 2, consistentOfficial: 2 });
  });
});
