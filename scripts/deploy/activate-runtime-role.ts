/** Activate the migrated app role from its deployment secret, before promotion. */
import { PrismaClient } from '@prisma/client';
import { assertDatabaseWriteAllowed, assertRuntimeDatabase, databaseTarget } from '../lib/db-target-guard';

let stage = 'migration target validation';
async function main() {
  const url = await assertDatabaseWriteAllowed(process.env['POSTGRES_URL_NON_POOLING']);
  stage = 'runtime binding validation (POSTGRES_PRISMA_URL must use fitsy_app and match SUPABASE_URL)';
  const runtime = new URL(assertRuntimeDatabase(process.env['POSTGRES_PRISMA_URL']));
  if (!runtime.password || databaseTarget(runtime.toString()).ref !== databaseTarget(url).ref) {
    throw new Error('Runtime role activation requires a password and the same database project as the migration');
  }
  const admin = new PrismaClient({ datasources: { db: { url } }, log: [] });
  stage = 'database login activation';
  try {
    await admin.$transaction(async tx => {
      // PostgreSQL quotes the bound password inside the server, never in argv/logs.
      await tx.$queryRaw`SELECT set_config('fitsy.runtime_password', ${decodeURIComponent(runtime.password)}, true)`;
      await tx.$executeRawUnsafe(`DO $activate$ BEGIN
        EXECUTE format('ALTER ROLE fitsy_app LOGIN PASSWORD %L', current_setting('fitsy.runtime_password'));
      END $activate$`);
    });
  } finally { await admin.$disconnect(); }
}
void main().catch(error => {
  const code: unknown = error?.meta?.code ?? error?.code;
  const diagnostic = typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? ` code=${code}` : '';
  console.error(`Runtime database role activation failed at ${stage}${diagnostic}; credential and driver details withheld`);
  process.exitCode = 1;
});
