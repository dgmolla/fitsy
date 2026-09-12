import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { planChainPilot, applyCatalogPlan, stateHash } from '../../services/chainPilotPlan';
import { applyAprilChainBatch } from '../../services/chainAprilBatch';
import { rollbackAprilBatch } from '../../services/chainPilotRollback';
import { approvedChainRow } from '../../services/chainCatalog';
import { applyAprilChainMatch } from '../../services/chainServing';
import { getMenuPage } from '../../lib/restaurantMenuService';
const url = process.env['POSTGRES_PRISMA_URL'];
const suite = url && ['localhost', 'postgres'].includes(new URL(url).hostname) ? describe : describe.skip;
suite('bounded April bulk writer with real serving and recovery', () => {
  const p = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  const guardClient = new Proxy(p, { get(target, property, receiver) {
    if (property === '$transaction') throw new Error('Guard must reject before reaching the database');
    return Reflect.get(target, property, receiver);
  } });
  let queries = 0;
  let queryDrained: (() => void) | undefined;
  p.$on('query', event => {
    if (event.query.includes('chain_april_test_drain')) queryDrained?.();
    else {
      // Measure the successful transaction's round trips, excluding aborted retries.
      if (event.query.trim().toUpperCase() === 'BEGIN') queries = 0;
      queries++;
    }
  });
  const drainQueryEvents = async () => {
    const observed = new Promise<void>(resolve => { queryDrained = resolve; });
    await p.$queryRaw`SELECT 1 AS chain_april_test_drain`;
    await observed;
    queryDrained = undefined;
  };
  afterAll(async () => p.$disconnect());
  test('serves a 100-item chunk, preserves prior estimates, no-ops and atomically restores all records', async () => p.$transaction(async tx => {
    // Full-catalog readers in other chain suites share this fixture lock.
    // Their unrelated writes must not add serialization retries to this budget.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78343218)`;
    const slug = 'bulk-' + randomUUID();
    const b = await p.brand.create({ data: { slug, displayName: slug, detectionConf: 'high', menuKind: 'restaurant' } });
    const r = await p.restaurant.create({ data: { name: slug, brandId: b.id, storeUuid: randomUUID(), source: slug, address: 'Local fixture', lat: 34, lng: -118, cuisineTags: [] } });
    try {
      const batch = { version: 1 as const, reviewedBy: 'Independent synthetic fixture facts', quarantine: [], changes: [{ slug, canonicalKey: 'bowl', expected: null,
        facts: { calories: 500, proteinG: 30, carbsG: 50, fatG: 20, servingSize: 'one bowl' }, source: { url: 'https://example.com/nutrition', sha256: 'a'.repeat(64) }, locator: 'Fixture label',
        aliases: Array.from({ length: 100 }, (_, i) => ({ name: 'Bowl ' + i, section: 'Bowls' })) }] };
      batch.changes.push({ ...batch.changes[0]!, canonicalKey: 'other', aliases: [{ name: 'Other dish', section: 'Sides' }] });
      batch.changes[0]!.aliases.push({ name: 'Renamed Bowl', section: 'Bowls' });
      await applyCatalogPlan(p, planChainPilot([b], [], batch), batch);
      const approved = approvedChainRow((await p.chainItem.findFirstOrThrow({ where: { brandId: b.id, canonicalKey: 'bowl' } })))!;
      const other = approvedChainRow((await p.chainItem.findFirstOrThrow({ where: { brandId: b.id, canonicalKey: 'other' } })))!;
      for (let i = 0; i < 100; i++) await p.menuItem.create({ data: { restaurantId: r.id, name: 'Bowl ' + i, section: 'Bowls', price: 12, dietaryTags: ['fixture'], calories: 400, proteinG: 20, carbsG: 50, fatG: 13,
        macroEstimates: { create: [{ source: 'haiku', calories: 400, proteinG: 20, carbsG: 50, fatG: 13, confidence: 'MEDIUM' },
          ...(i === 0 ? [{ source: 'official', calories: 350, proteinG: 15, carbsG: 40, fatG: 10, confidence: 'LOW' as const, reasoning: 'Old source', hadPhoto: true, ingredientBreakdown: [{ name: 'old' }], estimatedAt: new Date('2020-01-01'), expiresAt: new Date('2030-01-01') }] : [])] } } });
      const read = () => p.menuItem.findMany({ where: { restaurantId: r.id }, include: { macroEstimates: { orderBy: { id: 'asc' as const } } }, orderBy: { id: 'asc' as const } });
      const before = await read();
      const entries = before.map(before => ({ before, approved }));
      const oversized = Array.from({ length: 101 }, () => ({ before: { ...before[0]!, id: randomUUID() }, approved }));
      for (const invalid of [[], oversized, [entries[0]!, entries[0]!]]) {
        await expect(applyAprilChainBatch(guardClient, invalid)).rejects.toThrow('Invalid April chunk size or duplicate item');
      }
      // A valid early item must not commit when the final item's planned binding fails.
      await expect(applyAprilChainBatch(p, [...entries.slice(0, 99), { before: before[99]!, approved: other }])).rejects.toThrow('no current reviewed binding');
      expect(stateHash(await read())).toBe(stateHash(before));
      await p.restaurant.update({ where: { id: r.id }, data: { name: 'Different brand' } });
      await expect(applyAprilChainBatch(p, entries)).rejects.toThrow('Restaurant brand identity changed');
      expect(stateHash(await read())).toBe(stateHash(before));
      await p.restaurant.update({ where: { id: r.id }, data: { name: r.name } });
      await p.chainItem.update({ where: { id: approved.id }, data: { calories: approved.calories + 1 } });
      await expect(applyAprilChainBatch(p, entries)).rejects.toThrow('Chain review changed');
      expect(stateHash(await read())).toBe(stateHash(before));
      await p.chainItem.update({ where: { id: approved.id }, data: { calories: approved.calories } });
      await p.$executeRaw`UPDATE "MenuItem" SET name = 'Renamed Bowl' WHERE id = ${before[99]!.id}`;
      const renamed = await read();
      expect(renamed[99]!.updatedAt).toEqual(before[99]!.updatedAt);
      await expect(applyAprilChainBatch(p, entries)).rejects.toThrow('April item changed');
      expect(stateHash(await read())).toBe(stateHash(renamed));
      await p.$executeRaw`UPDATE "MenuItem" SET name = ${before[99]!.name} WHERE id = ${before[99]!.id}`;
      const stale = before.map(before => ({ before, approved }));
      stale[99] = { before: { ...before[99]!, updatedAt: new Date(0) }, approved };
      await expect(applyAprilChainBatch(p, stale)).rejects.toThrow('April item changed');
      expect(stateHash(await read())).toBe(stateHash(before));
      const estimate = before[99]!.macroEstimates[0]!;
      await p.macroEstimate.update({ where: { id: estimate.id }, data: { reasoning: 'Concurrent edit' } });
      const concurrentlyEdited = await read();
      await expect(applyAprilChainBatch(p, before.map(before => ({ before, approved })))).rejects.toThrow('April estimates changed');
      expect(stateHash(await read())).toBe(stateHash(concurrentlyEdited));
      await p.macroEstimate.update({ where: { id: estimate.id }, data: { reasoning: estimate.reasoning } });
      await drainQueryEvents(); queries = 0;
      const legacy = await applyAprilChainMatch(p, before[0]!, approved);
      await drainQueryEvents();
      const singleItemQueries = queries;
      await rollbackAprilBatch(p, [{ before: before[0]!, after: legacy }]);
      await drainQueryEvents(); queries = 0;
      const shuffled = [...entries].reverse(), written = await applyAprilChainBatch(p, shuffled);
      await drainQueryEvents();
      expect(queries).toBeLessThan(25);
      expect(queries).toBeLessThan(singleItemQueries + 5);
      expect(written.map(i => i.id)).toEqual(shuffled.map(e => e.before.id));
      let after = before.map(b => written.find(i => i.id === b.id)!);
      // Each stale field must independently defeat the no-op shortcut.
      for (const patch of [{ hadPhoto: true }, { ingredientBreakdown: [{ name: 'old' }] }, { confidence: 'LOW' as const },
        { reasoning: 'Outdated source proof' }, { calories: 499 }, { proteinG: 29 }, { carbsG: 49 }, { fatG: 19 }] satisfies Prisma.MacroEstimateUpdateInput[]) {
        const official = after[0]!.macroEstimates.find(e => e.source === 'official')!;
        await p.macroEstimate.update({ where: { id: official.id }, data: patch });
        after = await applyAprilChainBatch(p, (await read()).map(before => ({ before, approved })));
        expect(after[0]!.macroEstimates.find(e => e.source === 'official')).toMatchObject({
          calories: 500, proteinG: 30, carbsG: 50, fatG: 20, reasoning: official.reasoning, confidence: 'HIGH', hadPhoto: false, ingredientBreakdown: null,
        });
      }
      const page = await getMenuPage(p, r.id, { limit: 250 });
      expect(page!.menuItems).toHaveLength(100);
      for (const item of page!.menuItems) expect(item.macros).toMatchObject({ calories: 500, proteinG: 30, carbsG: 50, fatG: 20, confidence: 'HIGH' });
      for (const item of after) {
        const previous = before.find(b => b.id === item.id)!;
        expect(item.macroEstimates.find(e => e.source === 'haiku')).toEqual(previous.macroEstimates.find(e => e.source === 'haiku'));
        for (const key of ['id', 'name', 'price', 'dietaryTags', 'createdAt'] as const) expect(item[key]).toEqual(previous[key]);
        const oldOfficial = previous.macroEstimates.find(e => e.source === 'official');
        if (oldOfficial) {
          const refreshed = item.macroEstimates.find(e => e.source === 'official')!;
          expect(refreshed.id).toBe(oldOfficial.id);
          expect(refreshed.estimatedAt.getTime()).toBeGreaterThan(oldOfficial.estimatedAt.getTime());
          expect(refreshed.expiresAt).toEqual(oldOfficial.expiresAt);
        }
      }
      expect(stateHash(await applyAprilChainBatch(p, after.map(before => ({ before, approved }))))).toBe(stateHash(after));
      await expect(applyAprilChainBatch(p, before.map(before => ({ before, approved })))).rejects.toThrow('April item changed');
      expect(stateHash(await read())).toBe(stateHash(after));
      const journals = before.map((before, i) => ({ before, after: after[i]! }));
      await expect(rollbackAprilBatch(guardClient, [])).resolves.toBeUndefined();
      await expect(rollbackAprilBatch(guardClient, [journals[0]!, journals[0]!])).rejects.toThrow('April rollback identity mismatch');
      // Exercise the same JSON/date representation the rollback CLI reads.
      const malformed = JSON.parse(JSON.stringify(journals)) as typeof journals;
      malformed.find(j => j.before.macroEstimates.some(e => e.source === 'official'))!.before.macroEstimates.find(e => e.source === 'official')!.id = randomUUID();
      await expect(rollbackAprilBatch(p, malformed)).rejects.toThrow('April rollback readback mismatch');
      expect(stateHash(await read())).toBe(stateHash(after));
      await p.menuItem.update({ where: { id: after[99]!.id }, data: { price: 99 } });
      const edited = await read();
      await expect(rollbackAprilBatch(p, journals)).rejects.toThrow('changed after apply');
      expect(stateHash(await read())).toBe(stateHash(edited));
      await p.menuItem.update({ where: { id: after[99]!.id }, data: { price: after[99]!.price, updatedAt: after[99]!.updatedAt } });
      await drainQueryEvents(); queries = 0;
      await rollbackAprilBatch(p, journals);
      await drainQueryEvents();
      expect(queries).toBeLessThan(15);
      expect(stateHash(await read())).toBe(stateHash(before));
    } finally {
      await p.restaurant.delete({ where: { id: r.id } });
      await p.chainItem.deleteMany({ where: { brandId: b.id } });
      await p.brand.delete({ where: { id: b.id } });
    }
  }, { timeout: 120_000, maxWait: 120_000 }), 125_000);
});
