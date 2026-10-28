import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import april from '../fixtures/__snapshots__/chain-pilot-april.json';
import { cleanupFixtures, parseOptions, type Counts } from '../../../../scripts/maintenance/cleanup-test-fixtures';
import { PROD_PROJECT_REF } from '../../../../scripts/lib/db-target-guard';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const root = resolve(__dirname, '../../../..');
const exec = promisify(execFile);
suite('fixture cleanup through its real database and CLI', () => {
  const p = new PrismaClient();
  let scopes: string[], brandIds: string[], restaurantIds: string[], checkpointIds: string[];
  let variantMenu: string;
  const report = () => cleanupFixtures(p, parseOptions([]));
  async function cli(args: string[], url = process.env['POSTGRES_PRISMA_URL']!) {
    return exec(process.execPath, ['--import', 'tsx', 'scripts/maintenance/cleanup-test-fixtures.ts', ...args], {
      cwd: root, timeout: 20_000, env: { ...process.env, POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url },
      maxBuffer: 2 * 1024 * 1024,
    });
  }
  beforeEach(async () => {
    scopes = [randomUUID(), randomUUID()]; brandIds = []; restaurantIds = []; checkpointIds = [];
    const pilot = await p.brand.create({ data: { slug: scopes[0] + 'waba-grill', displayName: scopes[0] + ' WaBa Grill', detectionConf: 'high' } });
    const expansion = await p.brand.create({ data: { slug: scopes[1] + 'waba-grill', displayName: scopes[1] + 'waba-grill', detectionConf: 'high' } });
    brandIds.push(pilot.id, expansion.id);
    await p.chainItem.create({ data: { brandId: pilot.id, canonicalKey: 'chicken-plate', source: 'official', confidence: 'HIGH' } });
    const fixture = april.find(f => f.slug === 'waba-grill')!;
    variantMenu = randomUUID();
    for (const data of [
      { storeUuid: scopes[0] + fixture.restaurantId, name: scopes[0] + ' ' + fixture.restaurantName, address: 'Captured fixture', brandId: pilot.id },
      { storeUuid: scopes[0]!, name: pilot.displayName, address: 'Rollback fixture', brandId: pilot.id },
      { storeUuid: scopes[0] + pilot.id, name: pilot.displayName + ' (New Location)', address: 'New hex fixture', brandId: pilot.id },
      { id: randomUUID(), storeUuid: scopes[1] + variantMenu, name: expansion.displayName, address: 'Captured variant', brandId: expansion.id },
      { storeUuid: scopes[1] + 'new-waba-grill', name: expansion.displayName + ' (New Location)', address: 'New hex fixture', brandId: null },
    ]) {
      const r = await p.restaurant.create({ data: { ...data, lat: 34, lng: -118, source: 'ue_feed', cuisineTags: [] } });
      restaurantIds.push(r.id);
      const item = await p.menuItem.create({ data: { ...(r.address === 'Captured variant' ? { id: variantMenu } : {}),
        restaurantId: r.id, name: fixture.name, sourceItemId: 'ue:captured-item' } });
      await p.macroEstimate.create({ data: { menuItemId: item.id, calories: 400, proteinG: 20, carbsG: 50, fatG: 13, confidence: 'MEDIUM', source: 'haiku' } });
    }
    for (const [runId, hexId] of [[scopes[0]!, scopes[0] + 'waba-grill'], [scopes[1]!, 'waba-grill']]) {
      const row = await p.pipelineCompletedHex.create({ data: { runId: runId!, hexId: hexId!, count: 1 } });
      checkpointIds.push(row.id);
    }
  });
  afterEach(async () => {
    await p.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
    await p.chainItem.deleteMany({ where: { brandId: { in: brandIds } } });
    await p.brand.deleteMany({ where: { id: { in: brandIds } } });
    await p.pipelineCompletedHex.deleteMany({ where: { id: { in: checkpointIds } } });
  });
  afterAll(async () => { await p.$disconnect(); });

  test('default CLI runs with SELECT-only permissions and leaves all fixture rows intact', async () => {
    const role = 'fixture_ro_' + randomUUID().replaceAll('-', '');
    await p.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD 'synthetic-readonly' BYPASSRLS`);
    try {
      await p.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await p.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`);
      const url = new URL(process.env['POSTGRES_PRISMA_URL']!);
      url.username = role; url.password = 'synthetic-readonly';
      const { stdout } = await cli([], url.toString());
      const result = JSON.parse(stdout);
      expect(result.mode).toBe('dry-run');
      expect(result.transactionReadOnly).toBe(true);
      expect(result.counts).toEqual({ Brand: 2, ChainItem: 1, Restaurant: 5, MenuItem: 5, MacroEstimate: 5, SavedItem: 0, PipelineCompletedHex: 2 });
      expect(result.ambiguous).toEqual([]);
      expect(result.rows.Restaurant.map((r: { id: string }) => r.id).sort()).toEqual([...restaurantIds].sort());
      expect(await report()).toEqual(result);
    } finally {
      await p.$executeRawUnsafe(`DROP OWNED BY "${role}"`);
      await p.$executeRawUnsafe(`DROP ROLE "${role}"`);
    }
  });

  test('count mismatch aborts; exact apply deletes only the complete fixture closure', async () => {
    const before = await report();
    const live = await p.restaurant.create({ data: { storeUuid: randomUUID(), name: 'WaBa Grill', address: '123 Real Street', source: 'ue_feed', lat: 34, lng: -118, cuisineTags: [] } });
    restaurantIds.push(live.id);
    const apply = (counts: Counts) => cleanupFixtures(p, { ...parseOptions([]), apply: true, expect: counts });
    await expect(apply({ ...before.counts, MacroEstimate: 0 })).rejects.toThrow(/Counts differ/);
    expect(await report()).toEqual(before);
    const { stdout } = await cli(['--apply', '--expect=' + JSON.stringify(before.counts)]);
    expect(JSON.parse(stdout).counts).toEqual(before.counts);
    expect((await report()).counts).toEqual({ Brand: 0, ChainItem: 0, Restaurant: 0, MenuItem: 0, MacroEstimate: 0, SavedItem: 0, PipelineCompletedHex: 0 });
    expect(await p.restaurant.findUnique({ where: { id: live.id } })).not.toBeNull();
  });

  test('address collisions, foreign brand references and bookmarks are ambiguous and prevent all deletes', async () => {
    const collision = await p.restaurant.create({ data: { storeUuid: randomUUID(), name: 'WaBa Grill', address: 'Captured fixture', brandId: brandIds[0]!, source: 'ue_feed', lat: 34, lng: -118, cuisineTags: [] } });
    restaurantIds.push(collision.id);
    const user = await p.user.create({ data: { id: randomUUID(), email: randomUUID() + '@example.com' } });
    try {
      const saved = await p.savedItem.create({ data: { userId: user.id, restaurantId: restaurantIds[0]!, menuItemId: variantMenu, itemType: 'menu_item' } });
      const before = await report();
      expect(before.ambiguous.map(a => a.table).sort()).toEqual(['Restaurant', 'SavedItem']);
      expect(before.rows.SavedItem.map(r => r.id)).toEqual([saved.id]);
      await expect(cleanupFixtures(p, { ...parseOptions([]), apply: true, expect: before.counts })).rejects.toThrow(/Ambiguous/);
      expect(await report()).toEqual(before);
    } finally { await p.user.delete({ where: { id: user.id } }); }
  });

  test('a failed parent delete rolls back earlier nutrition and menu deletes', async () => {
    const before = await report();
    await p.$executeRawUnsafe('CREATE FUNCTION fixture_cleanup_skip_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$');
    await p.$executeRawUnsafe('CREATE TRIGGER fixture_cleanup_skip_delete BEFORE DELETE ON "Restaurant" FOR EACH ROW EXECUTE FUNCTION fixture_cleanup_skip_delete()');
    try {
      await expect(cleanupFixtures(p, { ...parseOptions([]), apply: true, expect: before.counts })).rejects.toThrow(/rolled back/);
      expect(await report()).toEqual(before);
    } finally {
      await p.$executeRawUnsafe('DROP TRIGGER fixture_cleanup_skip_delete ON "Restaurant"');
      await p.$executeRawUnsafe('DROP FUNCTION fixture_cleanup_skip_delete()');
    }
  });

  test('a same-shape checkpoint without a verified fixture scope is preserved as ambiguous', async () => {
    const orphan = await p.pipelineCompletedHex.create({ data: { runId: randomUUID(), hexId: 'waba-grill', count: 1 } });
    checkpointIds.push(orphan.id);
    const before = await report();
    expect(before.rows.PipelineCompletedHex.map(row => row.id)).not.toContain(orphan.id);
    expect(before.ambiguous).toEqual([expect.objectContaining({ table: 'PipelineCompletedHex', row: expect.objectContaining({ id: orphan.id }) })]);
    await expect(cleanupFixtures(p, { ...parseOptions([]), apply: true, expect: before.counts })).rejects.toThrow(/Ambiguous/);
    expect(await p.pipelineCompletedHex.findUnique({ where: { id: orphan.id } })).not.toBeNull();
    expect(await report()).toEqual(before);
  });

  test('actual CLI rejects a synthetic production route before connecting and never prints credentials', async () => {
    const url = new URL(process.env['POSTGRES_PRISMA_URL']!);
    url.username = 'postgres.' + PROD_PROJECT_REF; url.password = 'secret-marker-must-not-leak';
    const before = await report();
    try {
      await cli(['--apply', '--expect=' + JSON.stringify(before.counts)], url.toString());
      throw new Error('Expected production refusal');
    } catch (error) {
      const output = (error as { stderr: string }).stderr;
      expect(output).toContain('DB_WRITE_REFUSED');
      expect(output).not.toContain('secret-marker');
    }
    expect(await report()).toEqual(before);
  });
});
