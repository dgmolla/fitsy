import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertTestDatabase } from '../../../../scripts/lib/test-database-guard';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const root = resolve(__dirname, '../../../..');
const migration = readFileSync(resolve(root, 'prisma/migrations/20261029000000_private_public_schema/migration.sql'), 'utf8');
const audit = readFileSync(resolve(root, 'scripts/security/supabase-audit.sql'), 'utf8')
  .split(';').find(sql => sql.includes('AS audit_inherits_schema_owner'))!;
const clients = ['anon', 'authenticated'];
type Exposure = { client_role: string; schema_usage: boolean; privilege_type: string;
  table_privilege: boolean; any_column_privilege: boolean };

suite('PostGIS metadata client exposure (disposable PostgreSQL only)', () => {
  const databaseUrl = process.env['POSTGRES_PRISMA_URL'];
  const fixtureUrl = databaseUrl ? new URL(assertTestDatabase(databaseUrl)) : undefined;
  // Match fresh Data API sessions after the migration's schema-cache reload.
  // Rolled-back fixtures cannot deliver NOTIFY to a real PostgREST listener.
  fixtureUrl?.searchParams.set('statement_cache_size', '0');
  // Guard the exact datasource after adding the fresh-session option.
  const admin = fixtureUrl
    ? new PrismaClient({ datasourceUrl: assertTestDatabase(fixtureUrl.toString()) })
    : new PrismaClient();
  afterAll(() => admin.$disconnect());

  // Catalog/role fixtures, schema grants and metadata writes all roll back.
  // The extension and its table keep their original owners throughout.
  async function fixture(run: (tx: Prisma.TransactionClient, migrator: string) => Promise<void>) {
    const rollback = new Error('rollback isolated metadata fixture');
    const migrator = 'metadata_migrator_' + randomUUID().replaceAll('-', '');
    await expect(admin.$transaction(async tx => {
      for (const role of clients) {
        const exists = await tx.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = ${role})`;
        if (!exists[0]!.exists) await tx.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
      }
      await tx.$executeRawUnsafe(`CREATE ROLE ${migrator} NOLOGIN NOINHERIT`);
      await tx.$executeRawUnsafe(`ALTER SCHEMA public OWNER TO ${migrator}`);
      await tx.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO PUBLIC, anon, authenticated');
      await tx.$executeRawUnsafe('GRANT ALL ON TABLE public.spatial_ref_sys TO anon, authenticated');
      await tx.$executeRawUnsafe('GRANT SELECT ON TABLE public.spatial_ref_sys TO PUBLIC');
      await run(tx, migrator);
      throw rollback;
    }, { timeout: 30_000 })).rejects.toBe(rollback);
  }

  async function apply(tx: Prisma.TransactionClient, migrator: string) {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${migrator}`);
    await tx.$executeRawUnsafe(migration);
    await tx.$executeRawUnsafe('RESET ROLE');
  }

  async function denied(tx: Prisma.TransactionClient, sql: string) {
    await tx.$executeRawUnsafe('SAVEPOINT denied_operation');
    const operation = sql.startsWith('SELECT') ? tx.$queryRawUnsafe(sql) : tx.$executeRawUnsafe(sql);
    await expect(operation).rejects.toMatchObject({ meta: { code: '42501' } });
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT denied_operation');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT denied_operation');
  }

  test('a non-extension owner closes client reads and writes while preserving PostGIS and backend Prisma reads', async () => {
    await fixture(async (tx, migrator) => {
      const snapshot = () => tx.$queryRaw`SELECT c.relowner::text, c.relacl::text, c.relrowsecurity,
        e.extowner::text, e.extversion, e.extnamespace::text
        FROM pg_class c CROSS JOIN pg_extension e
        WHERE c.oid = 'public.spatial_ref_sys'::regclass AND e.extname = 'postgis'`;
      const before = await snapshot();
      const srid = 998977;
      const operations = [
        `SELECT srid FROM public.spatial_ref_sys WHERE srid = 4326`,
        `INSERT INTO public.spatial_ref_sys (srid, auth_name) VALUES (${srid}, 'Isolated fixture')`,
        `UPDATE public.spatial_ref_sys SET auth_name = 'Updated fixture' WHERE srid = ${srid}`,
        `DELETE FROM public.spatial_ref_sys WHERE srid = ${srid}`,
        'TRUNCATE public.spatial_ref_sys',
      ];
      for (const role of clients) {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        expect(await tx.$queryRawUnsafe(operations[0]!)).toEqual([{ srid: 4326 }]);
        for (const sql of operations.slice(1, 4)) expect(await tx.$executeRawUnsafe(sql)).toBe(1);
        // Prove SQL-only TRUNCATE exposure without losing reference definitions.
        await tx.$executeRawUnsafe('SAVEPOINT truncate_fixture');
        await tx.$executeRawUnsafe(operations[4]!);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT truncate_fixture');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT truncate_fixture');
        await tx.$executeRawUnsafe('RESET ROLE');
      }
      const exposed = await tx.$queryRawUnsafe<Exposure[]>(audit);
      expect(exposed.length).toBeGreaterThanOrEqual(14);
      expect(exposed.every(row => row.schema_usage && row.table_privilege)).toBe(true);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${migrator}`);
      expect(await tx.$queryRaw`SELECT current_user AS name,
        has_table_privilege(current_user, 'public.spatial_ref_sys', 'SELECT WITH GRANT OPTION') AS can_grant,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`).toEqual([
        { name: migrator, can_grant: false, superuser: false },
      ]);
      await tx.$executeRawUnsafe('RESET ROLE');
      await apply(tx, migrator);
      await apply(tx, migrator); // Safe to replay without touching extension objects.
      const closed = await tx.$queryRawUnsafe<Exposure[]>(audit);
      expect(closed).toHaveLength(exposed.length);
      expect(closed.every(row => !row.schema_usage && row.table_privilege)).toBe(true);
      for (const role of clients) {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        for (const sql of operations) await denied(tx, sql);
        await tx.$executeRawUnsafe('RESET ROLE');
      }
      for (const role of ['fitsy_app', 'pipeline_writer', 'fitsy_audit_readonly']) {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        expect(await tx.restaurant.count()).toBeGreaterThan(0);
        expect(await tx.menuItem.count()).toBeGreaterThan(0);
        const [point] = await tx.$queryRaw<{ x: number; y: number }[]>`
          SELECT ST_X(p) AS x, ST_Y(p) AS y
          FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(-118, 34), 4326), 3857) AS p) transform`;
        expect(point!.x).toBeCloseTo(-13135699.91, 1);
        expect(point!.y).toBeCloseTo(4028802.03, 1);
        await tx.$executeRawUnsafe('RESET ROLE');
      }
      expect(await snapshot()).toEqual(before);
      expect(await tx.$queryRaw`SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'public'`)
        .toEqual([{ owner: migrator }]);
    });
  });

  test('the audit detects inherited column grants even when table-level privileges are absent', async () => {
    await fixture(async (tx, migrator) => {
      const reader = 'metadata_reader_' + randomUUID().replaceAll('-', '');
      await tx.$executeRawUnsafe(`CREATE ROLE ${reader} NOLOGIN`);
      await tx.$executeRawUnsafe('REVOKE ALL ON TABLE public.spatial_ref_sys FROM PUBLIC, anon, authenticated');
      await tx.$executeRawUnsafe(`GRANT SELECT (srid), UPDATE (auth_name) ON TABLE public.spatial_ref_sys TO ${reader}`);
      await tx.$executeRawUnsafe(`GRANT ${reader} TO anon WITH INHERIT TRUE`);
      const exposure = () => tx.$queryRawUnsafe<Exposure[]>(audit);
      const inherited = (rows: Exposure[]) => rows.filter(row => row.client_role === 'anon' &&
        ['SELECT', 'UPDATE'].includes(row.privilege_type));
      expect(inherited(await exposure())).toEqual([
        expect.objectContaining({ privilege_type: 'SELECT', table_privilege: false, any_column_privilege: true, schema_usage: true }),
        expect.objectContaining({ privilege_type: 'UPDATE', table_privilege: false, any_column_privilege: true, schema_usage: true }),
      ]);
      await apply(tx, migrator);
      expect(inherited(await exposure()).every(row => !row.schema_usage && !row.table_privilege && row.any_column_privilege)).toBe(true);
      await tx.$executeRawUnsafe('SET LOCAL ROLE anon');
      await denied(tx, 'SELECT srid FROM public.spatial_ref_sys');
      await tx.$executeRawUnsafe('RESET ROLE');
    });
  });

  test('inherited schema access refuses the migration and rolls back its revokes atomically', async () => {
    await fixture(async (tx, migrator) => {
      const inherited = 'metadata_schema_' + randomUUID().replaceAll('-', '');
      await tx.$executeRawUnsafe(`CREATE ROLE ${inherited} NOLOGIN`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${inherited}`);
      await tx.$executeRawUnsafe(`GRANT ${inherited} TO anon WITH INHERIT TRUE`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${migrator}`);
      await tx.$executeRawUnsafe('SAVEPOINT inherited_grant');
      await expect(tx.$executeRawUnsafe(migration)).rejects.toMatchObject({ meta: { code: 'P0001',
        message: expect.stringContaining('retains public schema USAGE') } });
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT inherited_grant');
      await tx.$executeRawUnsafe('RESET ROLE');
      // A failed migration must not leave either client partially revoked.
      expect(await tx.$queryRaw`SELECT rolname, has_schema_privilege(oid, 'public', 'USAGE') AS usage
        FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname`).toEqual([
        { rolname: 'anon', usage: true }, { rolname: 'authenticated', usage: true },
      ]);
    });
  });
});
