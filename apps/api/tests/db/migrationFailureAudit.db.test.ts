import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabase } from '../../../../scripts/lib/test-database-guard';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const root = resolve(__dirname, '../../../..');
const audit = readFileSync(resolve(root, 'scripts/deploy/migration-failure-audit.sql'), 'utf8')
  .split(';').find(sql => sql.includes('AS migration_failure_audit'))!;
const migrationName = '20261028130000_hex_jobs';
const checksum = createHash('sha256')
  .update(readFileSync(resolve(root, `prisma/migrations/${migrationName}/migration.sql`))).digest('hex');

suite('failed-migration recovery evidence (disposable PostgreSQL only)', () => {
  const url = process.env['POSTGRES_PRISMA_URL'];
  const admin = url ? new PrismaClient({ datasourceUrl: assertTestDatabase(url) }) : new PrismaClient();
  afterAll(() => admin.$disconnect());

  test('reports unresolved attempts and partial objects without changing history or disclosing driver logs', async () => {
    const rollback = new Error('rollback isolated migration audit fixture');
    await expect(admin.$transaction(async tx => {
      const failedId = randomUUID(), otherId = randomUUID(), resolvedId = randomUUID(), interruptedId = randomUUID();
      for (const [id, name, logs, rolledBack] of [
        [failedId, migrationName, 'ERROR: role "pipeline_writer" does not exist; private-fixture-driver-detail', false],
        [otherId, 'isolated_other_failure', 'private-fixture-driver-detail', false],
        [resolvedId, migrationName, 'private-fixture-driver-detail', true],
        [interruptedId, migrationName, null, false],
      ] as const) {
        await tx.$executeRaw`INSERT INTO public._prisma_migrations
          (id, checksum, migration_name, logs, started_at, rolled_back_at, applied_steps_count)
          VALUES (${id}, ${checksum}, ${name}, ${logs}, CURRENT_TIMESTAMP,
            CASE WHEN ${rolledBack} THEN CURRENT_TIMESTAMP ELSE NULL END, 0)`;
      }
      const history = () => tx.$queryRaw`SELECT * FROM public._prisma_migrations ORDER BY id`;
      const before = await history();
      const [row] = await tx.$queryRawUnsafe<{ migration_failure_audit: {
        migration_history: { id: string; checksum: string; unresolved: boolean;
          failure_logs_present: boolean; missing_pipeline_writer: boolean | null }[];
        relations: { name: string; present: boolean; rls: boolean; acl: string }[];
        roles: { name: string; present: boolean }[];
      } }[]>(audit);
      const report = row!.migration_failure_audit;
      expect(report.migration_history.find(item => item.id === failedId)).toMatchObject({
        checksum, unresolved: true, missing_pipeline_writer: true,
      });
      expect(report.migration_history.find(item => item.id === otherId)).toMatchObject({
        unresolved: true, missing_pipeline_writer: false,
      });
      expect(report.migration_history.find(item => item.id === resolvedId)).toMatchObject({ unresolved: false });
      expect(report.migration_history.find(item => item.id === interruptedId)).toMatchObject({
        unresolved: true, failure_logs_present: false, missing_pipeline_writer: null,
      });
      // Existing objects are material evidence of partial effects, even if the
      // ledger says a migration failed. Never infer a safe rollback from logs.
      expect(report.relations).toEqual(['hex_job_events', 'hex_jobs'].map(name => expect.objectContaining({
        name, present: true, rls: true, acl: expect.any(String),
      })));
      expect(report.roles).toEqual(['fitsy_app', 'fitsy_audit_readonly', 'pipeline_writer'].map(name => ({ name, present: true })));
      expect(JSON.stringify(report)).not.toContain('private-fixture-driver-detail');
      expect(await history()).toEqual(before);
      throw rollback;
    }, { timeout: 15_000 })).rejects.toBe(rollback);
  });
});
