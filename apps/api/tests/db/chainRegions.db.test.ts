import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import { approvedChainRow, chainReviewHash } from '../../services/chainCatalog';
import { applyAprilChainMatch, loadChainServing, chainMenuResolver } from '../../services/chainServing';
import { applyAprilChainBatch, restoreAprilChainBatch } from '../../services/chainAprilBatch';
import { stateHash } from '../../services/chainPilotPlan';
import { getMenuPage } from '../../lib/restaurantMenuService';
import { persistHex } from '../../../../scripts/hex-persist';
import { persistItems } from '../../../../scripts/pipeline-utils';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
async function waitForRestaurantLock(observer: Prisma.TransactionClient, writerPid: number, holderPid: number) {
  for (let tries = 0; tries < 100; tries++) {
    // Activity query text is cached separately from live wait events. The holder
    // has locked only Restaurant, so its actual blocking PID proves the awaited row lock.
    const [{ blockers }] = await observer.$queryRaw<[{ blockers: number[] }]>`SELECT pg_blocking_pids(${writerPid}::integer) AS blockers`;
    if (blockers.length) { expect(blockers).toEqual([holderPid]); return; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Writer did not wait on the restaurant lock held by ${holderPid}`);
}
suite('regional official nutrition through the real writer and served menu', () => {
  const p = new PrismaClient(), scope = randomUUID();
  afterAll(async () => { await p.$disconnect(); });
  test('observes the actual Restaurant blocker when activity text is cached before the wait', async () => {
    const restaurant = await p.restaurant.create({ data: { name: scope, storeUuid: `${scope}-observer`, address: 'Lock observer fixture', lat: 34, lng: -118, source: 'test', cuisineTags: [] } });
    const url = new URL(process.env['POSTGRES_PRISMA_URL']!);
    url.searchParams.set('connection_limit', '1');
    const writer = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    let pending: Promise<unknown> | undefined;
    try {
      const [{ pid: writerPid }] = await writer.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
      await writer.$queryRaw`SELECT id FROM "ChainItem" LIMIT 1`;
      await p.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Restaurant" WHERE id = ${restaurant.id} FOR UPDATE`;
        const [{ pid: holderPid }] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
        // Pin the pre-wait query text to reproduce pg_stat_activity's mixed snapshot deterministically.
        const [before] = await tx.$queryRaw<{ query: string }[]>`SELECT query FROM pg_stat_activity WHERE pid = ${writerPid}`;
        expect(before?.query).toContain('"ChainItem"');
        pending = writer.$queryRaw`SELECT id FROM "Restaurant" WHERE id = ${restaurant.id} FOR UPDATE`.then(rows => rows);
        void pending.catch(() => {});
        await waitForRestaurantLock(tx, writerPid, holderPid);
        const [during] = await tx.$queryRaw<{ query: string; wait_event_type: string }[]>`SELECT query, wait_event_type FROM pg_stat_activity WHERE pid = ${writerPid}`;
        expect(during).toEqual({ query: before?.query, wait_event_type: 'Lock' });
      }, { timeout: 10_000 });
      await expect(pending).resolves.toEqual([{ id: restaurant.id }]);
    } finally {
      await pending?.catch(() => {});
      await writer.$disconnect();
      await p.restaurant.delete({ where: { id: restaurant.id } });
    }
  });
  test('a California-only fact reaches California menus while Ohio keeps its estimate', async () => {
    const brand = await p.brand.create({ data: { slug: scope, displayName: scope, detectionConf: 'high' } });
    try {
      const item = { name: 'Plain Croissant', section: 'Bakery', description: 'One butter croissant' };
      const row = await p.chainItem.create({ data: { brandId: brand.id, canonicalKey: 'ca/croissant',
        servingSize: 'One croissant', calories: 300, proteinG: 6, carbsG: 33, fatG: 16,
        source: 'official', confidence: 'HIGH', officialUrl: 'https://example.com/california-nutrition.pdf' } });
      const review = { version: 1 as const, sourceHash: 'a'.repeat(64), reviewedBy: 'Regional regression fixture',
        locator: 'California food guide, croissant row', aliases: [item], usStates: ['CA', 'IL'] };
      const approved = approvedChainRow(await p.chainItem.update({ where: { id: row.id }, data: { review: { ...review, dataHash: chainReviewHash(row, review) } } }))!;
      const runtime = await loadChainServing(p);
      for (const [location, lat, lng] of [['California', 34.0522, -118.2437], ['Ohio', 41.4993, -81.6944]] as const) {
        const restaurant = await p.restaurant.create({ data: { storeUuid: scope + location, name: brand.displayName,
          ...(location === 'Ohio' ? { brandId: brand.id } : {}), address: location, lat, lng, source: 'ue_feed', cuisineTags: [] } });
        const { resolveMacros } = chainMenuResolver({ ...restaurant, storeUuid: restaurant.storeUuid! }, runtime);
        const macros = await resolveMacros([item],
          async items => items.map(() => ({ calories: 400, proteinG: 8, carbsG: 44, fatG: 21, confidence: 'MEDIUM' as const, source: 'haiku', dietaryTags: [] })));
        await persistHex(scope, location, [{ restaurantId: restaurant.id, brandId: brand.id,
          menuHash: scope + location, items: [{ item, macro: macros[0]! }] }], p);
        expect(await p.restaurant.findUniqueOrThrow({ where: { id: restaurant.id } })).toMatchObject({ brandId: brand.id, chainFlag: true });
        const page = await getMenuPage(p, restaurant.id, { limit: 10 });
        const served = page!.menuItems[0]!.macros;
        expect(served).toMatchObject({ calories: location === 'California' ? 300 : 400, confidence: location === 'California' ? 'HIGH' : 'MEDIUM' });
        if (location === 'California') {
          const include = { macroEstimates: { orderBy: { id: 'asc' as const } } };
          const snapshot = () => p.menuItem.findUniqueOrThrow({ where: { restaurantId_name: { restaurantId: restaurant.id, name: item.name } }, include });
          const original = await snapshot(), pairs = [{ item, macro: macros[0]! }];
          await expect(persistItems(restaurant.id, [{ item, macro: { ...macros[0]!, calories: 301 } }], p)).rejects.toThrow('facts changed');
          await expect(persistItems(restaurant.id, [{ item, macro: { ...macros[0]!, reasoning: '{"kind":"reviewed-chain-v1"}' } }], p)).rejects.toThrow('proof is incomplete');
          await p.restaurant.update({ where: { id: restaurant.id }, data: { name: 'Unrelated bakery' } });
          await expect(persistItems(restaurant.id, pairs, p)).rejects.toThrow('brand changed');
          await expect(persistHex(scope, 'renamed', [{ restaurantId: restaurant.id, brandId: brand.id, menuHash: 'renamed', items: pairs }], p)).rejects.toThrow('brand changed');
          expect(await p.pipelineCompletedHex.count({ where: { runId: scope, hexId: 'renamed' } })).toBe(0);
          await p.restaurant.update({ where: { id: restaurant.id }, data: { name: restaurant.name } });
          await expect(persistHex(scope, 'wrong-brand', [{ restaurantId: restaurant.id, brandId: randomUUID(), menuHash: 'wrong', items: pairs }], p)).rejects.toThrow('brand changed');
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
      const directory = mkdtempSync(join(tmpdir(), 'fitsy-chain-region-')), repo = resolve(__dirname, '../../../..');
      try {
        const batchPath = join(directory, 'batch.json'), planPath = join(directory, 'plan.json');
        writeFileSync(batchPath, JSON.stringify({ version: 1, reviewedBy: review.reviewedBy, quarantine: [], changes: [{ slug: brand.slug,
          canonicalKey: row.canonicalKey, expected: null, facts: { calories: 300, proteinG: 6, carbsG: 33, fatG: 16, servingSize: 'One croissant' },
          source: { url: row.officialUrl, sha256: review.sourceHash }, locator: review.locator, aliases: [item], usStates: ['IL', 'CA'] }] }));
        const run = (...args: string[]) => execFileSync(process.execPath, [join(repo, 'node_modules/tsx/dist/cli.mjs'),
          '--tsconfig', join(repo, 'apps/api/tsconfig.json'), join(repo, 'scripts/preload-chain-pilot.ts'), ...args, '--batch=' + batchPath],
        { cwd: repo, encoding: 'utf8', timeout: 30_000 }).trim().split('\n').map(line => JSON.parse(line)).at(-1);
        const california = await p.restaurant.findUniqueOrThrow({ where: { storeUuid: scope + 'California' } });
        const current = () => p.menuItem.findMany({ where: { restaurantId: california.id }, include: { macroEstimates: { orderBy: { id: 'asc' as const } } } });
        const beforeCli = await current(), planned = run('april-plan', planPath);
        expect(planned.matched).toBe(1);
        const plan = JSON.parse(readFileSync(planPath, 'utf8'));
        expect(plan.rows.map((r: { before: { restaurantId: string } }) => r.before.restaurantId)).toEqual([california.id]);
        run('april-apply', planPath, planned.hash, '--limit=1', '--chunk-size=100');
        expect((await current())[0]!.calories).toBe(300);
        run('april-rollback', planPath + '.journal');
        expect(stateHash(await current())).toBe(stateHash(beforeCli));
      } finally { rmSync(directory, { recursive: true, force: true }); }
      // Real overlapping April lock and an all-estimated hex must not form a deadlock.
      const ohio = await p.restaurant.findUniqueOrThrow({ where: { storeUuid: scope + 'Ohio' } });
      const saved = await p.menuItem.findFirstOrThrow({ where: { restaurantId: ohio.id } });
      const url = new URL(process.env['POSTGRES_PRISMA_URL']!);
      url.searchParams.set('application_name', scope); url.searchParams.set('connection_limit', '1');
      const writer = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      let pending: Promise<number> | undefined;
      try {
        const [{ pid: writerPid }] = await writer.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
        const california = await p.restaurant.findUniqueOrThrow({ where: { storeUuid: scope + 'California' } });
        for (const mode of ['single', 'batch']) {
          const before = await p.menuItem.findFirstOrThrow({ where: { restaurantId: california.id }, include: { macroEstimates: { orderBy: { id: 'asc' } } } });
          let applying: Promise<unknown> | undefined;
          try {
            await p.$transaction(async tx => {
              await tx.$queryRaw`SELECT id FROM "Restaurant" WHERE id = ${california.id} FOR UPDATE`;
              const [{ pid: holderPid }] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
              applying = mode === 'single' ? applyAprilChainMatch(writer, before, approved) : applyAprilChainBatch(writer, [{ before, approved }]);
              void applying.catch(() => {});
              await waitForRestaurantLock(p, writerPid, holderPid);
              expect(await tx.$queryRaw`SELECT id FROM "MenuItem" WHERE id = ${before.id} FOR UPDATE NOWAIT`).toEqual([{ id: before.id }]);
            }, { timeout: 10_000 });
            await applying;
          } finally { await applying?.catch(() => {}); }
        }
        await p.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "Restaurant" WHERE id = ${ohio.id} FOR SHARE`;
          const [{ pid: holderPid }] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
          pending = persistHex(scope, 'concurrent-estimated', [{ restaurantId: ohio.id, brandId: brand.id,
            menuHash: 'concurrent-estimated', items: [{ item, macro: { calories: 400, proteinG: 8, carbsG: 44, fatG: 21,
              confidence: 'MEDIUM', source: 'haiku', dietaryTags: [] } }] }], writer);
          void pending.catch(() => {});
          await waitForRestaurantLock(p, writerPid, holderPid);
          // Old order holds MenuItem before Restaurant; NOWAIT fails immediately instead of deadlocking.
          expect(await tx.$queryRaw`SELECT id FROM "MenuItem" WHERE id = ${saved.id} FOR UPDATE NOWAIT`).toEqual([{ id: saved.id }]);
        }, { timeout: 10_000 });
        await expect(pending).resolves.toBe(1);
        expect(await p.pipelineCompletedHex.count({ where: { runId: scope, hexId: 'concurrent-estimated' } })).toBe(1);
      } finally { await pending?.catch(() => {}); await writer.$disconnect(); }
    } finally {
      await p.restaurant.deleteMany({ where: { storeUuid: { startsWith: scope } } });
      await p.chainItem.deleteMany({ where: { brandId: brand.id } });
      await p.brand.delete({ where: { id: brand.id } });
      await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    }
  }, 125_000);
});
