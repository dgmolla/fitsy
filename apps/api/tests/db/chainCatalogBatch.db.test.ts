import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { chainPilot } from '../../services/chainPilotData';
import { stateHash } from '../../services/chainPilotPlan';
const url = process.env['POSTGRES_PRISMA_URL'];
const suite = url && ['localhost', 'postgres'].includes(new URL(url).hostname) ? describe : describe.skip;
suite('catalog batch CLI with arbitrary brands', () => {
  const p = new PrismaClient();
  afterAll(async () => p.$disconnect());
  test.each([1, 3])('catalog batch preserves serving and rollback with chunk size %i', async (chunkSize) => p.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78343218)`;
    const directory = mkdtempSync(join(tmpdir(), 'fitsy-batch-')), root = resolve(__dirname, '../../../..');
    const slugs = ['a', 'b'].map(letter => 'batch-' + letter + '-' + randomUUID());
    const file = join(directory, 'batch.json');
    const batch = { version: 1, reviewedBy: 'Fixture source audit', quarantine: [], changes: slugs.map((slug, i) => ({
      ...chainPilot.changes[i]!, slug, canonicalKey: 'standard-plate', expected: null,
      aliases: [{ name: 'Standard Plate', section: 'Plates', description: '' }],
    })) };
    writeFileSync(file, JSON.stringify(batch));
    const run = (command: string, name: string, ...extra: string[]) => JSON.parse(execFileSync(process.execPath,
      [require.resolve('tsx/cli'), '--tsconfig', join(root, 'apps/api/tsconfig.json'), join(root, 'scripts/preload-chain-pilot.ts'), command, join(directory, name), ...extra, '--batch=' + file],
      { cwd: root, env: { ...process.env, POSTGRES_URL_NON_POOLING: url! }, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').at(-1)!);
    const query = { where: { restaurant: { brandRef: { slug: { in: slugs } } } }, include: { macroEstimates: { orderBy: { id: 'asc' as const } } }, orderBy: { id: 'asc' as const } };
    try {
      for (const slug of slugs) {
        const brand = await p.brand.create({ data: { slug, displayName: slug, detectionConf: 'high' } });
        for (let i = 0; i < 2; i++) {
          const r = await p.restaurant.create({ data: { storeUuid: randomUUID(), name: slug, brandId: brand.id, source: 'ue_feed', address: 'Fixture', lat: 34, lng: -118, cuisineTags: [] } });
          await p.menuItem.create({ data: { restaurantId: r.id, name: 'Standard Plate', section: 'Plates', description: '', price: 12, calories: 1, proteinG: 0, carbsG: 0, fatG: 0 } });
        }
      }
      const before = await p.menuItem.findMany(query);
      expect(run('menu-inventory', 'inventory.json')).toEqual({ inspected: 4, uniqueVariants: 2 });
      const plan = run('catalog-plan', 'catalog.json'); expect(plan.changes).toBe(2);
      const changed = structuredClone(batch); changed.changes[0]!.facts = { ...changed.changes[0]!.facts, calories: 821 };
      writeFileSync(file, JSON.stringify(changed));
      expect(() => run('catalog-apply', 'catalog.json', plan.hash)).toThrow('definition changed');
      writeFileSync(file, JSON.stringify(batch));
      // A failed attempt saved its intent marker; a new plan is required rather than overwriting evidence.
      const retry = run('catalog-plan', 'retry.json'); expect(run('catalog-apply', 'retry.json', retry.hash).applied).toBe(2);
      const april = run('april-plan', 'april.json'); expect(april.matched).toBe(4);
      const rows = JSON.parse(readFileSync(join(directory, 'april.json'), 'utf8')).rows;
      expect(new Set(rows.slice(0, 2).map((r: { approved: { brandId: string } }) => r.approved.brandId)).size).toBe(2);
      expect(run('april-apply', 'april.json', april.hash, '--limit=4', '--chunk-size=' + chunkSize).applied).toBe(4);
      const after = await p.menuItem.findMany(query);
      expect(after.map(i => i.calories).sort()).toEqual([820, 820, 980, 980]);
      expect(after.map(i => [i.id, i.price])).toEqual(before.map(i => [i.id, i.price]));
      expect(run('april-plan', 'zero.json').matched).toBe(0);
      expect(run('april-rollback', 'april.json.journal').rolledBack).toBe(4);
      expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(before));
      if (chunkSize > 1) {
        const stopped = run('april-plan', 'stopped.json');
        const planned = JSON.parse(readFileSync(join(directory, 'stopped.json'), 'utf8')).rows;
        const last = planned[3].before;
        await p.menuItem.update({ where: { id: last.id }, data: { price: 99 } });
        for (const bad of ['0', '101', '1.5', 'abc']) expect(() => run('april-apply', 'stopped.json', stopped.hash, '--limit=4', '--chunk-size=' + bad)).toThrow('Invalid April chunk size');
        expect(() => run('april-apply', 'stopped.json', stopped.hash, '--chunk-size=3', '--chunk-size=3')).toThrow('Chunk size applies only to April apply');
        expect(() => run('april-plan', 'wrong-command.json', '--chunk-size=3')).toThrow('Chunk size applies only to April apply');
        expect(() => run('april-apply', 'stopped.json', stopped.hash, '--limit=4', '--chunk-size=3')).toThrow('April item changed');
        expect(JSON.parse(readFileSync(join(directory, 'stopped.json.journal/stopped.json'), 'utf8')).count).toBe(3);
        expect(run('april-rollback', 'stopped.json.journal')).toEqual({ rolledBack: 3, expected: 3 });
        expect((await p.menuItem.findUniqueOrThrow({ where: { id: last.id } })).price).toBe(99);
        await p.menuItem.update({ where: { id: last.id }, data: { price: last.price, updatedAt: new Date(last.updatedAt) } });
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(before));
        const complete = run('april-plan', 'complete.json');
        expect(run('april-apply', 'complete.json', complete.hash, '--limit=4', '--chunk-size=3').applied).toBe(4);
        const completedRows = await p.menuItem.findMany(query);
        const receipt = join(directory, 'complete.json.journal/chunk-3.json');
        renameSync(receipt, receipt + '.saved');
        try { expect(() => run('april-rollback', 'complete.json.journal')).toThrow('Incomplete or mixed April chunk evidence'); }
        finally { renameSync(receipt + '.saved', receipt); }
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(completedRows));
        const exactReceipt = readFileSync(receipt, 'utf8');
        writeFileSync(receipt, JSON.stringify({ ...JSON.parse(exactReceipt), hash: 'changed' }));
        try { expect(() => run('april-rollback', 'complete.json.journal')).toThrow('Invalid April chunk receipt'); }
        finally { writeFileSync(receipt, exactReceipt); }
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(completedRows));
        const misplaced = join(directory, 'complete.json.journal/chunk-4.json');
        renameSync(receipt, misplaced);
        try { expect(() => run('april-rollback', 'complete.json.journal')).toThrow('Incomplete or mixed April chunk evidence'); }
        finally { renameSync(misplaced, receipt); }
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(completedRows));
        const stray = join(directory, 'complete.json.journal/0.json'); writeFileSync(stray, '{}');
        try { expect(() => run('april-rollback', 'complete.json.journal')).toThrow('Incomplete or mixed April chunk evidence'); }
        finally { rmSync(stray); }
        const intent = join(directory, 'complete.json.journal/chunk-3.started.json'), exactIntent = readFileSync(intent, 'utf8');
        renameSync(intent, intent + '.saved');
        try { expect(() => run('april-rollback', 'complete.json.journal')).toThrow('Missing April chunk intent'); }
        finally { renameSync(intent + '.saved', intent); }
        writeFileSync(intent, JSON.stringify({ ...JSON.parse(exactIntent), count: 99 }));
        try { expect(() => run('april-rollback', 'complete.json.journal')).toThrow('Invalid April chunk intent'); }
        finally { writeFileSync(intent, exactIntent); }
        const started = join(directory, 'complete.json.journal/started.json'), exactStarted = readFileSync(started, 'utf8');
        const legacy = JSON.parse(exactStarted); delete legacy.chunkSize; writeFileSync(started, JSON.stringify(legacy));
        try { expect(() => run('april-rollback', 'complete.json.journal')).toThrow('Mixed April journal evidence'); }
        finally { writeFileSync(started, exactStarted); }
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(completedRows));
        const removed = completedRows[3]!;
        await p.menuItem.delete({ where: { id: removed.id } });
        expect(() => run('april-rollback', 'complete.json.journal')).toThrow('April row changed after apply; refusing rollback');
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(completedRows.filter(i => i.id !== removed.id)));
        const { macroEstimates, ...menu } = removed;
        await p.menuItem.create({ data: { ...menu, macroEstimates: { create: macroEstimates.map(({ menuItemId: _menuItemId, ingredientBreakdown: _ingredientBreakdown, ...estimate }) => ({ ...estimate, ingredientBreakdown: Prisma.DbNull })) } } });
        expect(run('april-rollback', 'complete.json.journal').rolledBack).toBe(4);
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(before));
      }
      expect(run('catalog-rollback', 'retry.json.applied.json').rolledBack).toBe(2);
    } finally {
      await p.restaurant.deleteMany({ where: { brandRef: { slug: { in: slugs } } } });
      await p.chainItem.deleteMany({ where: { brand: { slug: { in: slugs } } } });
      await p.brand.deleteMany({ where: { slug: { in: slugs } } });
      rmSync(directory, { recursive: true, force: true });
    }
  }, { timeout: 120_000, maxWait: 120_000 }), 125_000);
});
