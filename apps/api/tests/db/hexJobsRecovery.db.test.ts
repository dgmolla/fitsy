import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabase } from '../../../../scripts/lib/test-database-guard';
import { failedAttempt, resolveHexJobs } from '../../../../scripts/deploy/recover-hex-jobs';
import { migrationAudit } from '../../../../scripts/deploy/migration-failure-audit';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const root = resolve(__dirname, '../../../..');

suite('incident #643 recovery with the real Prisma engine (disposable PostgreSQL only)', () => {
  test('P3009 blocks deploy, reviewed recovery preserves history, then filtered deploy resumes', async () => {
    const original = assertTestDatabase(process.env['POSTGRES_PRISMA_URL']);
    const admin = new PrismaClient({ datasourceUrl: original });
    const database = 'hex_recovery_' + randomUUID().replaceAll('-', '');
    const url = new URL(original); url.pathname = '/' + database; url.searchParams.delete('schema');
    const target = assertTestDatabase(url.toString());
    const directory = mkdtempSync(join(tmpdir(), 'fitsy-hex-recovery-db-'));
    let client: PrismaClient | undefined;
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
      client = new PrismaClient({ datasourceUrl: target });
      const schema = join(directory, 'prisma/schema.prisma');
      mkdirSync(join(directory, 'scripts/deploy'), { recursive: true });
      cpSync(join(root, 'scripts/deploy/pipeline-roles-approval.mjs'), join(directory, 'scripts/deploy/pipeline-roles-approval.mjs'));
      const migrations = join(directory, 'prisma/migrations');
      mkdirSync(migrations, { recursive: true });
      symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
      writeFileSync(schema, 'datasource db {\n  provider = "postgresql"\n  url = env("POSTGRES_PRISMA_URL")\n}\n');
      writeFileSync(join(migrations, 'migration_lock.toml'), 'provider = "postgresql"\n');
      const marker = (name: string) => {
        const path = join(migrations, name); mkdirSync(path);
        writeFileSync(join(path, 'migration.sql'), `CREATE TABLE public.${name.endsWith('before') ? 'recovery_before' : 'recovery_after'} (id INT);\n`);
      };
      marker('20261028110000_recovery_before');
      for (const name of ['20261028120000_pipeline_writer_roles', failedAttempt.migration_name]) {
        cpSync(join(root, 'prisma/migrations', name), join(migrations, name), { recursive: true });
      }
      const deploy = () => spawnSync(process.execPath, [join(directory, 'scripts/deploy/pipeline-roles-approval.mjs'), '--deploy'], {
        cwd: directory, env: { ...process.env, POSTGRES_PRISMA_URL: target, POSTGRES_URL_NON_POOLING: target,
          FITSY_PIPELINE_ROLES_APPROVED_SHA256: '' }, encoding: 'utf8', timeout: 30_000,
      });
      const initial = deploy(); expect(initial.status).toBe(0);
      marker('20261028160000_recovery_after');
      // Recreate the observed production ledger, including NULL logs, in an
      // isolated database. The production audit is read-only and remains real.
      await client.$executeRaw`INSERT INTO public._prisma_migrations
        (id, checksum, migration_name, started_at, applied_steps_count)
        VALUES (${failedAttempt.id}, ${failedAttempt.checksum}, ${failedAttempt.migration_name},
          '2026-10-28T18:56:48.891157+00:00'::timestamptz, 0)`;
      const ledger = () => client!.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM public._prisma_migrations ORDER BY id`;
      const before = await ledger();
      const blocked = deploy();
      expect(blocked.status).toBe(1);
      expect(blocked.stdout + blocked.stderr).toContain('P3009');
      expect(await ledger()).toEqual(before);
      await client.$executeRawUnsafe('CREATE TABLE public.hex_jobs (id INT)');
      await expect(resolveHexJobs(client, target, schema)).rejects.toThrow(/audit differs/);
      expect(await ledger()).toEqual(before);
      await client.$executeRawUnsafe('DROP TABLE public.hex_jobs');
      await expect(resolveHexJobs(client, target.replace(database, 'postgres'), schema))
        .rejects.toThrow(/audited database/);
      await expect(resolveHexJobs(client, target, join(directory, 'missing.prisma')))
        .rejects.toThrow(/Prisma resolve failed/);
      expect(await ledger()).toEqual(before);
      const receipt = await resolveHexJobs(client, target, schema);
      expect(receipt.after.migration_history[0]).toMatchObject({ ...failedAttempt, unresolved: false });
      expect(receipt.before.runtime_schema).toEqual({ migration_name: '20261029010000_widget_search_tokens',
        migration_history: [], relation_present: false });
      expect(receipt.after.runtime_schema).toEqual(receipt.before.runtime_schema);
      expect(await ledger()).toEqual(before.map(row => row.id === failedAttempt.id
        ? { ...row, rolled_back_at: expect.any(Date) } : row));
      const recovered = await ledger();
      await expect(resolveHexJobs(client, target, schema)).rejects.toThrow(/audit differs/);
      expect(await ledger()).toEqual(recovered);
      const resumed = deploy();
      expect(resumed.status).toBe(0);
      expect(await client.$queryRaw`SELECT to_regclass('public.recovery_after')::text AS name`)
        .toEqual([{ name: 'recovery_after' }]);
      const audited = await migrationAudit(client);
      expect(audited.relations.every(item => item.present === false)).toBe(true);
      expect(audited.migration_history).toEqual(receipt.after.migration_history);
      expect((await ledger()).find(row => row.id === failedAttempt.id))
        .toEqual(recovered.find(row => row.id === failedAttempt.id));
    } finally {
      await client?.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 90_000);
});
