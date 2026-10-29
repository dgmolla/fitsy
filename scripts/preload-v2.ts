import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertDevDatabase, assertPipelineDatabase } from './lib/db-target-guard';
import { digest, V2Journal } from './pipeline-v2/journal';
import { parseOptions, runV2Hex, targetIdentity } from './pipeline-v2/run';
import { parseQueueOptions, runQueueCommand } from './pipeline-v2/queue-worker';
import { parseUeRateOptions, SharedUeRateLimiter } from './pipeline-v2/ue-rate-limiter';
import { parsePdfOptions, runPdfCommand } from './pipeline-v2/pdf-worker';
import { parseBudgetOptions, SharedServiceBudget } from './pipeline-v2/service-budget';
import { v2Telemetry } from './pipeline-v2/telemetry';
import { runDashboardCommand } from './pipeline-v2/dashboard';
import { runRolloutCommand } from './pipeline-v2/rollout';

/** Keep the guarded datasource at the connection entrypoint for the writer inventory to verify. */
export async function v2Database(value = process.env['PIPELINE_DATABASE_URL']): Promise<string> {
  return await assertPipelineDatabase(assertDevDatabase(value));
}

/** A tracked deletion is part of the candidate source, even before commit. */
export function pipelineSourceHash(files: string[]): string {
  return digest(files.map(file => {
    try { return [file, digest(readFileSync(file).toString('base64'))]; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return [file, null];
    }
  }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'rollout') { process.stdout.write(JSON.stringify(runRolloutCommand(args)) + '\n'); return; }
  if (args[0] === 'dashboard') { await runDashboardCommand(args); return; }
  const rateCommand = args[0] === 'ue-rate';
  const budgetCommand = args[0] === 'budgets';
  const budgetConfig = budgetCommand ? parseBudgetOptions(args) : undefined;
  const capRps = rateCommand ? parseUeRateOptions(args) : undefined;
  const queued = args[0] === 'enqueue' || args[0] === 'worker' ? parseQueueOptions(args) : undefined;
  const pdf = args[0] === 'pdf-enqueue' || args[0] === 'pdf-worker' ? parsePdfOptions(args) : undefined;
  const options = queued || rateCommand || budgetCommand || pdf ? undefined : parseOptions(args), url = await v2Database();
  let prisma: PrismaClient | undefined;
  let journal: V2Journal | undefined;
  try {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    if (budgetCommand) {
      const budget = new SharedServiceBudget(prisma);
      if (budgetConfig) await budget.configure(budgetConfig.service, budgetConfig.usd, budgetConfig.calls);
      process.stdout.write(JSON.stringify(await budget.state()) + '\n');
      return;
    }
    if (rateCommand) {
      const limiter = new SharedUeRateLimiter(prisma);
      const state = capRps === undefined ? await limiter.state() : await limiter.configure(capRps);
      process.stdout.write(JSON.stringify(state, (_key, value: unknown) => typeof value === 'bigint' ? String(value) : value) + '\n');
      return;
    }
    const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'package.json', 'scripts/package.json',
      'scripts/preload-v2.ts', 'scripts/pipeline-cloud-worker.ts', 'scripts/pipeline-v2', 'scripts/hex-persist.ts', 'scripts/hex-resume.ts', 'scripts/pipeline-utils.ts', 'scripts/menu-item-identity.ts',
      'scripts/preload-invariants.ts', 'scripts/lib/db-target-guard.ts', 'scripts/eval/lib/jev-experiment.ts', 'scripts/eval/suite/adapters.ts',
      'scripts/eval/pdf-finder',
      'scripts/eval/suite/types.ts', 'scripts/eval/jev-macro/*.ts', 'apps/api/services', 'packages/shared/src', 'prisma/schema.prisma',
      'prisma/migrations/20261028130000_hex_jobs', 'prisma/migrations/20261028140000_pipeline_ue_rate_limit',
      'prisma/migrations/20261028150000_pipeline_pdf_jobs', 'prisma/migrations/20261028160000_pipeline_service_budgets',
      'prisma/migrations/20261028170000_pipeline_cloud_runs']).split('\n').sort();
    const source = { event: 'source', at: new Date().toISOString(), head: git(['rev-parse', 'HEAD']),
      sourceHash: pipelineSourceHash(files),
      dirty: Boolean(git(['status', '--porcelain'])) };
    if (pdf) {
      const result = await runPdfCommand(prisma, pdf, source);
      process.stdout.write(JSON.stringify(result) + '\n');
      if ('status' in result && !['completed', 'idle'].includes(result.status)) process.exitCode = 1;
      return;
    }
    if (queued) {
      const result = await runQueueCommand(prisma, queued, targetIdentity(url), source);
      process.stdout.write(JSON.stringify(result) + '\n');
      if ('status' in result && result.status !== 'completed' && result.status !== 'idle') process.exitCode = 1;
      return;
    }
    if (!options) throw new Error('Missing hex options');
    const out = resolve(options.out);
    journal = new V2Journal(join(out, 'journal.jsonl'), { runId: options.runId, hexId: options.hexId, target: targetIdentity(url) }, options.capUsd, new SharedServiceBudget(prisma));
    journal.append(source);
    const report = await runV2Hex(prisma, options, journal);
    v2Telemetry.hex(report);
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.status !== 'completed') process.exitCode = 1;
  } finally {
    try {
      if (prisma && process.env['AXIOM_TOKEN']) v2Telemetry.budgets(await new SharedServiceBudget(prisma).state());
      await v2Telemetry.flush();
    }
    finally { try { await prisma?.$disconnect(); } finally { journal?.close(); } }
  }
}
if (process.argv[1] && /[/\\]preload-v2\.ts$/.test(process.argv[1])) {
  void main().catch(error => {
    // Prisma and provider exceptions may contain credentials. Retain only a safe setup diagnostic.
    console.error(error instanceof Error && !error.constructor.name.startsWith('Prisma') ? error.message : 'DEV POC database operation failed');
    process.exitCode = 1;
  });
}
