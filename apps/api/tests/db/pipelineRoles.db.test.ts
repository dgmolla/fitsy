import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabase } from '../../../../scripts/lib/test-database-guard';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const tables = ['Restaurant', 'Brand', 'ChainItem', 'MenuItem', 'MacroEstimate', 'PipelineCompletedHex'];
suite('pipeline database permissions (real Postgres)', () => {
  const admin = new PrismaClient();
  afterAll(() => admin.$disconnect());

  test.each(['fitsy_app', 'fitsy_audit_readonly'])('%s reads nutrition but cannot mutate it, even with read-only disabled', async role => {
    for (const table of tables) {
      for (const statement of [`INSERT INTO public."${table}" (id) SELECT 'denied' WHERE false`,
        `UPDATE public."${table}" SET id=id WHERE false`, `DELETE FROM public."${table}" WHERE false`]) {
        await expect(admin.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          await tx.$executeRawUnsafe('SET LOCAL transaction_read_only = off');
          await tx.$queryRawUnsafe(`SELECT count(*) FROM public."${table}"`);
          await tx.$executeRawUnsafe(statement);
        })).rejects.toMatchObject({ meta: { code: '42501' } });
      }
    }
  });

  test('roles cannot escalate, grant access, truncate or write outside their own domain', async () => {
    const [owner] = await admin.$queryRaw<{ name: string }[]>`SELECT current_user AS name`;
    const roles = await admin.$queryRaw<{ rolname: string; safe: boolean }[]>`
      SELECT rolname, NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls) AS safe
      FROM pg_roles WHERE rolname IN ('fitsy_app', 'pipeline_writer', 'fitsy_audit_readonly') ORDER BY rolname`;
    expect(roles).toHaveLength(3);
    expect(roles.every(role => role.safe)).toBe(true);
    for (const role of roles.map(row => row.rolname)) {
      await admin.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        const [privileges] = await tx.$queryRaw<{ create: boolean; truncate: boolean; grant: boolean }[]>`
          SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS create,
            has_table_privilege(current_user, 'public."MenuItem"', 'TRUNCATE') AS truncate,
            has_table_privilege(current_user, 'public."MenuItem"', 'UPDATE WITH GRANT OPTION') AS grant`;
        expect(privileges).toEqual({ create: false, truncate: false, grant: false });
      });
      await expect(admin.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL SESSION AUTHORIZATION ${role}`);
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${owner!.name.replaceAll('"', '""')}"`);
      })).rejects.toMatchObject({ meta: { code: '42501' } });
    }
    for (const role of ['pipeline_writer', 'fitsy_audit_readonly']) {
      await expect(admin.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        await tx.$executeRawUnsafe('UPDATE public."User" SET name=name WHERE false');
      })).rejects.toMatchObject({ meta: { code: '42501' } });
    }
  });

  test('pipeline_writer inserts, updates and deletes every pipeline table through Prisma with RLS enabled', async () => {
    const scope = randomUUID();
    await admin.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE pipeline_writer');
      const brand = await tx.brand.create({ data: { slug: scope, displayName: 'Role fixture' } });
      const restaurant = await tx.restaurant.create({ data: {
        storeUuid: scope, name: 'Role fixture', address: 'Synthetic', lat: 34, lng: -118, source: 'fixture', brandId: brand.id,
      } });
      const item = await tx.menuItem.create({ data: { restaurantId: restaurant.id, name: 'Fixture', calories: 400 } });
      const estimate = await tx.macroEstimate.create({ data: { menuItemId: item.id, calories: 400, proteinG: 20, carbsG: 40, fatG: 18, confidence: 'MEDIUM' } });
      const chain = await tx.chainItem.create({ data: { brandId: brand.id, canonicalKey: scope, source: 'official', confidence: 'HIGH' } });
      const hex = await tx.pipelineCompletedHex.create({ data: { runId: scope, hexId: scope, count: 1 } });
      await tx.brand.update({ where: { id: brand.id }, data: { displayName: 'Updated' } });
      await tx.restaurant.update({ where: { id: restaurant.id }, data: { name: 'Updated' } });
      await tx.menuItem.update({ where: { id: item.id }, data: { calories: 450 } });
      await tx.macroEstimate.update({ where: { id: estimate.id }, data: { calories: 450 } });
      await tx.chainItem.update({ where: { id: chain.id }, data: { calories: 450 } });
      await tx.pipelineCompletedHex.update({ where: { id: hex.id }, data: { count: 2 } });
      await tx.macroEstimate.delete({ where: { id: estimate.id } });
      await tx.menuItem.delete({ where: { id: item.id } });
      await tx.restaurant.delete({ where: { id: restaurant.id } });
      await tx.chainItem.delete({ where: { id: chain.id } });
      await tx.brand.delete({ where: { id: brand.id } });
      await tx.pipelineCompletedHex.delete({ where: { id: hex.id } });
    });
  });

  test('audit role reads populated tables and has no table or sequence mutation privileges', async () => {
    await admin.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE fitsy_audit_readonly');
      const rows = await tx.$queryRaw<{ name: string; write: boolean }[]>`
        SELECT c.relname AS name, has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')`;
      expect(rows.length).toBeGreaterThan(tables.length);
      expect(rows.every(row => !row.write)).toBe(true);
      expect(await tx.restaurant.count()).toBeGreaterThan(0);
      await tx.$queryRaw`SELECT count(*) FROM public._prisma_migrations`;
    });
  });

  test('real authenticated account and saved-item routes work using a fitsy_app login', async () => {
    const password = randomUUID().replaceAll('-', '');
    const url = new URL(assertTestDatabase(process.env['POSTGRES_PRISMA_URL']));
    url.username = 'fitsy_app'; url.password = password;
    // This cluster belongs to the disposable test launcher. Never activate shared roles.
    await admin.$executeRawUnsafe(`ALTER ROLE fitsy_app LOGIN PASSWORD '${password}'`);
    try {
      const output = execFileSync(process.execPath, [require.resolve('tsx/cli'), '--tsconfig',
        resolve(__dirname, '../../tsconfig.json'), '--test', '--test-reporter=tap',
        resolve(__dirname, 'pipelineRoles.integration.ts')], {
        encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, POSTGRES_PRISMA_URL: url.toString() },
      });
      expect(output).toMatch(/^# tests 1$/m);
      expect(output).toMatch(/^# fail 0$/m);
      expect(output).toMatch(/^# skipped 0$/m);
    } finally { await admin.$executeRawUnsafe('ALTER ROLE fitsy_app NOLOGIN PASSWORD NULL'); }
  }, 35_000);
});
