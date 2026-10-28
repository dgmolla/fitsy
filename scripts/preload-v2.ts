import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertDevDatabase, assertPipelineDatabase } from './lib/db-target-guard';
import { digest, V2Journal } from './pipeline-v2/journal';
import { parseOptions, runV2Hex, targetIdentity } from './pipeline-v2/run';

/** Keep the guarded datasource at the connection entrypoint for the writer inventory to verify. */
export async function v2Database(value = process.env['PIPELINE_DATABASE_URL']): Promise<string> {
  return await assertPipelineDatabase(assertDevDatabase(value));
}

async function main() {
  const options = parseOptions(process.argv.slice(2)), url = await v2Database();
  const out = resolve(options.out);
  const journal = new V2Journal(join(out, 'journal.jsonl'), { runId: options.runId, hexId: options.hexId, target: targetIdentity(url) }, options.capUsd);
  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'package.json', 'scripts/package.json',
      'scripts/preload-v2.ts', 'scripts/pipeline-v2', 'scripts/hex-persist.ts', 'scripts/hex-resume.ts', 'scripts/pipeline-utils.ts', 'scripts/menu-item-identity.ts',
      'scripts/preload-invariants.ts', 'scripts/lib/db-target-guard.ts', 'scripts/eval/lib/jev-experiment.ts', 'scripts/eval/suite/adapters.ts',
      'scripts/eval/suite/types.ts', 'scripts/eval/jev-macro/*.ts', 'apps/api/services', 'packages/shared/src', 'prisma/schema.prisma']).split('\n').sort();
    journal.append({ event: 'source', at: new Date().toISOString(), head: git(['rev-parse', 'HEAD']),
      sourceHash: digest(files.map(file => [file, digest(readFileSync(file).toString('base64'))])),
      dirty: Boolean(git(['status', '--porcelain'])) });
    const report = await runV2Hex(prisma, options, journal);
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.status !== 'completed') process.exitCode = 1;
  } finally { try { await prisma?.$disconnect(); } finally { journal.close(); } }
}
if (process.argv[1] && /[/\\]preload-v2\.ts$/.test(process.argv[1])) {
  void main().catch(error => {
    // Prisma and provider exceptions may contain credentials. Retain only a safe setup diagnostic.
    console.error(error instanceof Error && !error.constructor.name.startsWith('Prisma') ? error.message : 'DEV POC database operation failed');
    process.exitCode = 1;
  });
}
