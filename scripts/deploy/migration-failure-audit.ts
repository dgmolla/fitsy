/** Read-only evidence shared by failed Git builds and protected maintenance. */
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { assertDatabaseWriteAllowed, databaseTarget, PROD_PROJECT_REF } from '../lib/db-target-guard';

const root = resolve(__dirname, '../..');
const text = z.string().min(1), nullableText = text.nullable();
const checksum = z.string().regex(/^[a-f0-9]{64}$/);
// SQL JSON is an external boundary. Missing or contradictory evidence must not
// authorize Prisma or silently disappear from the recovery before/after check.
// Preserve additional audit fields so recovery still compares all evidence.
const auditSchema = z.looseObject({
  database: text,
  inspected_at: text,
  migration_history: z.array(z.looseObject({
    id: text, migration_name: text, checksum,
    started_at: text, finished_at: nullableText, rolled_back_at: nullableText,
    applied_steps_count: z.number().int().nonnegative(), unresolved: z.boolean(),
    failure_logs_present: z.boolean(), missing_pipeline_writer: z.boolean().nullable(),
  }).refine(row => row.unresolved === (row.finished_at === null && row.rolled_back_at === null))),
  relations: z.array(z.looseObject({
    name: z.enum(['hex_job_events', 'hex_jobs']), present: z.boolean(),
    kind: nullableText, owner: nullableText, rls: z.boolean().nullable(), acl: nullableText,
  })).length(2).refine(rows => new Set(rows.map(row => row.name)).size === 2),
  roles: z.array(z.looseObject({
    name: z.enum(['fitsy_app', 'fitsy_audit_readonly', 'pipeline_writer']), present: z.boolean(),
  })).length(3).refine(rows => new Set(rows.map(row => row.name)).size === 3),
  runtime_schema: z.looseObject({
    migration_name: text,
    migration_history: z.array(z.looseObject({
      id: text, checksum, finished_at: nullableText, rolled_back_at: nullableText,
    })),
    relation_present: z.boolean(),
  }),
});
export type Audit = z.infer<typeof auditSchema>;

export async function migrationAudit(client: PrismaClient): Promise<Audit> {
  const sql = readFileSync(join(root, 'scripts/deploy/migration-failure-audit.sql'), 'utf8')
    .split(';').find(statement => statement.includes('AS migration_failure_audit'))!;
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
    const [row] = await tx.$queryRawUnsafe<Array<{ migration_failure_audit: unknown }>>(sql);
    return auditSchema.parse(row?.migration_failure_audit);
  });
}

async function main() {
  const preflight = process.argv[3] === '--preflight';
  if (process.argv[2] !== '--prod' || process.argv.length !== (preflight ? 4 : 3)) {
    throw new Error('use --prod with optional --preflight');
  }
  // Reuse the signed Git-build identity and target guard. This command never
  // resolves migrations or grants roles, regardless of production write intent.
  const url = await assertDatabaseWriteAllowed(process.env['POSTGRES_URL_NON_POOLING']);
  if (databaseTarget(url).ref !== PROD_PROJECT_REF) throw new Error('production audit target required');
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  let evidence: Audit;
  try { evidence = await migrationAudit(client); }
  finally { await client.$disconnect(); }
  const unresolved = evidence.migration_history.filter(row => row.unresolved);
  if (!preflight || unresolved.length) process.stdout.write(JSON.stringify({ migration_failure_audit: evidence }) + '\n');
  if (preflight && unresolved.length) {
    console.error('TL;DR: Production migrations stopped before Prisma deploy because of unresolved migration history.\n' +
      unresolved.map(({ migration_name, id, started_at }) =>
        'Unresolved migration attempt: ' + JSON.stringify({ migration_name, id, started_at })).join('\n') + '\n' +
      'Inspect scripts/deploy/migration-failure-audit.sql and docs/engineering/devops/routine-production.md; ' +
      'production-migration-recovery.yml retains separate approval for the exact #643 attempt only. No automatic resolve or retry.');
    process.exitCode = 1;
  }
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
