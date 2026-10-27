/** Read-only dev diagnostics. Never migrate, seed, reset statistics or create indexes. */
import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertNotProd, isProdUrl } from '../../../../scripts/dev/lib/guard';
import { guidedPreviewSql } from '../../lib/guidedPreviewService';

export function databaseTarget(value: string | undefined, supabaseUrl: string | undefined): string {
  const target = assertNotProd(value, 'POSTGRES_URL_NON_POOLING');
  assert.ok(!isProdUrl(target), 'production performance audits are forbidden, including with FITSY_ALLOW_PROD');
  const url = new URL(target);
  assert.ok(['postgresql:', 'postgres:'].includes(url.protocol), 'expected a PostgreSQL dev URL');
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]'
    || (isIP(url.hostname) === 4 && url.hostname.split('.')[0] === '127');
  if (!loopback) {
    const supabase = new URL(supabaseUrl ?? '');
    assert.ok(supabase.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(supabase.hostname)
      && !isProdUrl(supabase.href), 'SUPABASE_URL must identify the dev project');
    const ref = supabase.hostname.split('.')[0]!;
    assert.ok(url.hostname === `db.${ref}.supabase.co`
      || (url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username).endsWith(`.${ref}`)),
    'database must belong to the supplied dev Supabase project');
  }
  return target;
}

async function main() {
  const datasourceUrl = databaseTarget(process.env['POSTGRES_URL_NON_POOLING'], process.env['SUPABASE_URL']);
  const prisma = new PrismaClient({ datasourceUrl });
  try {
    const report = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");
      const indexes = await tx.$queryRaw`SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename IN ('Restaurant', 'MenuItem', 'MacroEstimate', 'SavedItem', 'Subscription')
        ORDER BY tablename, indexname`;
      const tableScans = await tx.$queryRaw`SELECT relname, seq_scan::double precision AS "sequentialScans",
        idx_scan::double precision AS "indexScans", n_live_tup::double precision AS "estimatedLiveRows"
        FROM pg_stat_user_tables ORDER BY seq_scan DESC`;
      const params = { lat: 34.0407, lng: -118.2468,
        targets: { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 }, query: 'chicken' };
      const guidedPreviewPlan = await tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${guidedPreviewSql(params)}`);
      return { indexes, tableScans, guidedPreviewPlan };
    }, { timeout: 30_000 });
    let slowQueries: unknown;
    try {
      slowQueries = await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
        // Query IDs permit correlation in the Supabase dashboard without logging
        // SQL literals or statistics belonging to other database principals.
        return tx.$queryRaw`SELECT queryid::text AS "queryId", calls::double precision AS calls,
          mean_exec_time AS "meanMs", max_exec_time AS "maxMs", total_exec_time AS "totalMs", rows::double precision AS rows
          FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND userid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
          ORDER BY total_exec_time DESC LIMIT 20`;
      }, { timeout: 10_000 });
    } catch { slowQueries = { unavailable: 'pg_stat_statements is disabled or inaccessible; inspect Supabase Query Performance' }; }
    process.stdout.write(JSON.stringify({ version: 1, measuredAt: new Date().toISOString(), environment: 'dev/local, read-only transactions',
      workload: 'canonical guided preview SQL, DTLA, chicken, 600 kcal / P40 C60 F20', ...report, slowQueries }, null, 2) + '\n');
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1]?.endsWith('/performance/database.ts')) main().catch(() => {
  process.stderr.write('Dev database diagnostics failed. Check the target, credentials, connection and statement limits; no writes are permitted.\n');
  process.exitCode = 1;
});
