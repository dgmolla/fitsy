/** Read-only application-schema readiness after the guarded migration selection. */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertDatabaseWriteAllowed } from '../lib/db-target-guard';

const root = resolve(__dirname, '../..');
// Pipeline SQL may remain held, but this API's widget endpoints require this
// migration. An already-applied matching migration needs no repeated approval.
export const requiredRuntimeMigration = '20261029010000_widget_search_tokens';

export async function assertRuntimeMigrations(client: Pick<PrismaClient, '$queryRaw'>) {
  const checksum = createHash('sha256').update(readFileSync(join(root,
    'prisma/migrations', requiredRuntimeMigration, 'migration.sql'))).digest('hex');
  const rows = await client.$queryRaw<Array<{ checksum: string }>>`
    SELECT checksum FROM public._prisma_migrations
    WHERE migration_name = ${requiredRuntimeMigration}
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  if (rows.length !== 1 || rows[0]?.checksum !== checksum) {
    throw new Error(`Required runtime migration ${requiredRuntimeMigration} is absent, incomplete or changed`);
  }
}

async function main() {
  // Reuse the build's signed identity and exact DEV/PROD target guard even
  // though this command reads only migration metadata, never application data.
  const url = await assertDatabaseWriteAllowed(process.env['POSTGRES_URL_NON_POOLING']);
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    await assertRuntimeMigrations(client);
    process.stdout.write('Runtime migration preflight passed\n');
  } finally { await client.$disconnect(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)) {
  void main().catch(() => {
    console.error(`Runtime migration preflight failed: ${requiredRuntimeMigration} must be applied with matching SQL before API build. ` +
      'Inspect the guarded target, held migrations and docs/engineering/devops/routine-production.md; ' +
      'role approval and failed-migration recovery remain separately authorized. No automatic resolve or retry; driver details withheld.');
    process.exitCode = 1;
  });
}
