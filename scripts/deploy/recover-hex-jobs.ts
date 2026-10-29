/** One-off #643 maintenance. Never invoked by the ordinary production build. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { recoveryTarget, RecoveryRefused, refuseRecovery as refuse } from './hex-jobs-recovery-target';

const root = resolve(__dirname, '../..');
export const failedAttempt = {
  id: 'c4b89b99-d4a5-49d9-9664-4699383e5f81',
  migration_name: '20261028130000_hex_jobs',
  checksum: 'f793bacb999d2db72489a4bb9ab89bc2ae1da2a6b1ecff68942e66e1b65889b9',
};
export type Audit = {
  database: string;
  migration_history: Array<typeof failedAttempt & {
    started_at: string; finished_at: string | null; rolled_back_at: string | null;
    applied_steps_count: number; unresolved: boolean;
    failure_logs_present: boolean; missing_pipeline_writer: boolean | null;
  }>;
  relations: Array<{ name: string; present: boolean }>;
  roles: Array<{ name: string; present: boolean }>;
};

export function recoveryMode(args: string[]) {
  if (args.length !== 2 || !args.includes('--prod') ||
      !args.some(arg => ['--audit', '--resolve'].includes(arg))) refuse('use --prod and exactly one of --audit or --resolve');
  return args.includes('--resolve') ? 'resolve' : 'audit';
}


export function assertFailedAttempt(audit: Audit) {
  const row = audit.migration_history[0];
  const digest = createHash('sha256').update(readFileSync(join(root,
    'prisma/migrations', failedAttempt.migration_name, 'migration.sql'))).digest('hex');
  // This exact incident had NULL ledger logs. Its original PostgreSQL error and
  // transactional rollback must be reviewed using the linked runbook evidence.
  if (digest !== failedAttempt.checksum || audit.migration_history.length !== 1 ||
      !row || Object.entries(failedAttempt).some(([key, value]) => row[key as keyof typeof failedAttempt] !== value) ||
      row.started_at !== '2026-10-28T18:56:48.891157+00:00' || row.finished_at !== null || row.rolled_back_at !== null ||
      row.applied_steps_count !== 0 || row.unresolved !== true || row.failure_logs_present !== false ||
      row.missing_pipeline_writer !== null || audit.relations.length !== 2 ||
      !['hex_jobs', 'hex_job_events'].every(name => audit.relations.some(item => item.name === name && item.present === false))) {
    refuse('audit differs from the reviewed #643 failed attempt or contains partial effects; inspect before any recovery');
  }
}

export async function migrationAudit(client: PrismaClient): Promise<Audit> {
  const sql = readFileSync(join(root, 'scripts/deploy/migration-failure-audit.sql'), 'utf8')
    .split(';').find(statement => statement.includes('AS migration_failure_audit'))!;
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
    const [row] = await tx.$queryRawUnsafe<Array<{ migration_failure_audit: Audit }>>(sql);
    if (!row) return refuse('migration audit returned no snapshot');
    return row.migration_failure_audit;
  });
}

/** Called only after production identity validation; schema override supports disposable DB rehearsals. */
export async function resolveHexJobs(client: PrismaClient, url: string, schema = join(root, 'prisma/schema.prisma')) {
  const before = await migrationAudit(client);
  if (before.database !== new URL(url).pathname.slice(1)) refuse('audited database does not match the configured target');
  assertFailedAttempt(before);
  const result = spawnSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'),
    'migrate', 'resolve', '--rolled-back', failedAttempt.migration_name, '--schema', schema], {
    cwd: root, env: { ...process.env, POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url },
    encoding: 'utf8', timeout: 30_000,
  });
  if (result.status !== 0 || result.error || result.signal) {
    const directory = mkdtempSync(join(tmpdir(), 'fitsy-hex-recovery-'));
    writeFileSync(join(directory, 'prisma.log'), result.stdout + '\n' + result.stderr, { mode: 0o600 });
    refuse(`Prisma resolve failed; private diagnostics: ${directory}/prisma.log; do not automatically retry`);
  }
  const after = await migrationAudit(client), recovered = after.migration_history[0];
  const expected = structuredClone(before);
  if (!recovered?.rolled_back_at || recovered.unresolved !== false) return refuse('Prisma did not mark the expected attempt rolled back');
  expected.migration_history[0]!.rolled_back_at = recovered.rolled_back_at;
  expected.migration_history[0]!.unresolved = false;
  // Timestamps of the snapshots naturally differ; all observed history and
  // object/role state must otherwise remain unchanged.
  const state = (audit: Audit) => ({ database: audit.database, migration_history: audit.migration_history,
    relations: audit.relations, roles: audit.roles });
  if (!isDeepStrictEqual(state(after), state(expected))) refuse('database state changed beyond the expected rollback marker; retain evidence');
  return { before, after };
}

async function main() {
  const mode = recoveryMode(process.argv.slice(2)), url = await recoveryTarget(mode);
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    const evidence = mode === 'resolve' ? await resolveHexJobs(client, url) : await migrationAudit(client);
    process.stdout.write(JSON.stringify({ mode, source: process.env['GITHUB_SHA'], evidence }) + '\n');
  } finally { await client.$disconnect(); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)) {
  void main().catch(error => {
    console.error(error instanceof RecoveryRefused ? error.message : 'Migration recovery failed; database and provider details withheld; inspect before retrying');
    process.exitCode = 1;
  });
}
