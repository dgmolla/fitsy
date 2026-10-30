/** Read-only evidence shared by failed Git builds and protected maintenance. */
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertDatabaseWriteAllowed, databaseTarget, PROD_PROJECT_REF } from '../lib/db-target-guard';

const root = resolve(__dirname, '../..');
export type Audit = {
  database: string;
  migration_history: Array<{
    id: string; migration_name: string; checksum: string;
    started_at: string; finished_at: string | null; rolled_back_at: string | null;
    applied_steps_count: number; unresolved: boolean;
    failure_logs_present: boolean; missing_pipeline_writer: boolean | null;
  }>;
  relations: Array<{ name: string; present: boolean }>;
  roles: Array<{ name: string; present: boolean }>;
  runtime_schema: {
    migration_name: string;
    migration_history: Array<{ id: string; checksum: string; finished_at: string | null; rolled_back_at: string | null }>;
    relation_present: boolean;
  };
};

export async function migrationAudit(client: PrismaClient): Promise<Audit> {
  const sql = readFileSync(join(root, 'scripts/deploy/migration-failure-audit.sql'), 'utf8')
    .split(';').find(statement => statement.includes('AS migration_failure_audit'))!;
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
    const [row] = await tx.$queryRawUnsafe<Array<{ migration_failure_audit: Audit }>>(sql);
    if (!row) throw new Error('migration audit returned no snapshot');
    return row.migration_failure_audit;
  });
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--prod') throw new Error('explicit production audit required');
  // Reuse the signed Git-build identity and target guard. This command never
  // resolves migrations or grants roles, regardless of production write intent.
  const url = await assertDatabaseWriteAllowed(process.env['POSTGRES_URL_NON_POOLING']);
  if (databaseTarget(url).ref !== PROD_PROJECT_REF) throw new Error('production audit target required');
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  let evidence: Audit;
  try { evidence = await migrationAudit(client); }
  finally { await client.$disconnect(); }
  process.stdout.write(JSON.stringify({ migration_failure_audit: evidence }) + '\n');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)) {
  const unavailable = () => console.error('Migration failure audit unavailable; retain the original Prisma failure and inspect ' +
    'scripts/deploy/migration-failure-audit.sql through the production maintenance owner. Database details withheld.');
  // Bound identity, connection, query and disconnect together. Diagnostics must
  // not turn a terminal migration failure into a hanging deployment.
  const deadline = setTimeout(() => { unavailable(); process.exit(1); }, 10_000);
  void main().then(() => clearTimeout(deadline), () => {
    clearTimeout(deadline); unavailable(); process.exitCode = 1;
  });
}
