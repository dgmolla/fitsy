import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { chainPilot } from '../../services/chainPilotData';
import { stateHash } from '../../services/chainPilotPlan';
const url = process.env['POSTGRES_PRISMA_URL'];
const suite = url && ['localhost', 'postgres'].includes(new URL(url).hostname) ? describe : describe.skip;
suite('catalog batch CLI with arbitrary brands', () => {
  const p = new PrismaClient();
  afterAll(async () => p.$disconnect());
  test('one catalog batch supplies two brands, groups variants, updates in place and rolls back', async () => {
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
      expect(run('april-apply', 'april.json', april.hash, '--limit=4').applied).toBe(4);
      const after = await p.menuItem.findMany(query);
      expect(after.map(i => i.calories).sort()).toEqual([820, 820, 980, 980]);
      expect(after.map(i => [i.id, i.price])).toEqual(before.map(i => [i.id, i.price]));
      expect(run('april-plan', 'zero.json').matched).toBe(0);
      expect(run('april-rollback', 'april.json.journal').rolledBack).toBe(4);
      expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(before));
      expect(run('catalog-rollback', 'retry.json.applied.json').rolledBack).toBe(2);
    } finally {
      await p.restaurant.deleteMany({ where: { brandRef: { slug: { in: slugs } } } });
      await p.chainItem.deleteMany({ where: { brand: { slug: { in: slugs } } } });
      await p.brand.deleteMany({ where: { slug: { in: slugs } } });
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
