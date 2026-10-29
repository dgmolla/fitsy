import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertDevDatabase, assertPipelineDatabase } from './lib/db-target-guard';
import { targetIdentity } from './pipeline-v2/run';
import { cloudReadiness, cloudService } from './pipeline-v2/cloud-service';
import { digest, type JournalEvent } from './pipeline-v2/journal';
import { v2Telemetry } from './pipeline-v2/telemetry';

/** Deploy preflight and runtime share this contract; no implicit .env or application/admin fallback. */
export async function cloudEnvironment(env = process.env): Promise<{ url: string; port: number }> {
  const url = await assertPipelineDatabase(assertDevDatabase(env['PIPELINE_DATABASE_URL']));
  if (!env['TYPESAFE_API_KEY']?.trim()) throw new Error('TYPESAFE_API_KEY is required in the worker runtime secret store');
  const port = Number(env['PORT'] ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535');
  const datasource = new URL(url), connections = Number(datasource.searchParams.get('connection_limit') ?? 2);
  if (!Number.isInteger(connections) || connections < 1 || connections > 5) throw new Error('Worker connection_limit must be 1-5');
  datasource.searchParams.set('connection_limit', String(connections));
  return { url: datasource.toString(), port };
}
function sourceIdentity(): JournalEvent {
  if (process.argv[1]?.endsWith('.cjs')) {
    const source = JSON.parse(readFileSync(join(dirname(resolve(process.argv[1])), 'source.json'), 'utf8')) as JournalEvent;
    if (source.event !== 'source' || !/^[a-f0-9]{64}$/.test(String(source.sourceHash))) throw new Error('Missing container source identity');
    return source;
  }
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'scripts', 'apps/api/services',
    'packages/shared/src', 'prisma', 'package.json', 'package-lock.json']).split('\n').sort();
  const sources = files.map(path => {
    try { return [path, digest(readFileSync(path).toString('base64'))]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return [path, null]; }
  });
  return { event: 'source', at: new Date().toISOString(), sourceHash: digest(sources), dirty: Boolean(git(['status', '--porcelain'])), head: git(['rev-parse', 'HEAD']) };
}
async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error('Cloud worker takes no run limits or credentials in argv; use the private /runs control API');
  const { url, port } = await cloudEnvironment();
  const db = new PrismaClient({ datasources: { db: { url: await assertPipelineDatabase(assertDevDatabase(url)) } } });
  const controller = new AbortController();
  const { server, work } = cloudService(db, targetIdentity(url), sourceIdentity(), controller.signal);
  let deadline: NodeJS.Timeout | undefined;
  let closed: Promise<void> | undefined;
  const stop = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    closed = new Promise<void>(accept => server.close(() => accept()));
    server.closeIdleConnections();
    // Cloud Run gives SIGTERM ten seconds. Leave time for platform teardown after our bound.
    deadline = setTimeout(() => { process.stderr.write('Cloud worker shutdown deadline exceeded\n'); process.exit(1); }, 8000);
    deadline.unref();
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    await cloudReadiness(db);
    if (controller.signal.aborted) return;
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', accept); });
    process.stdout.write(JSON.stringify({ event: 'cloud_worker_ready', port }) + '\n');
    await work();
  } finally {
    stop();
    try { await Promise.all([closed, v2Telemetry.flush()]); } finally { await db.$disconnect(); }
    if (deadline) clearTimeout(deadline);
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  }
}
if (process.argv[1] && /[/\\]pipeline-cloud-worker\.(?:ts|cjs)$/.test(process.argv[1])) {
  void main().catch(() => { console.error('Cloud worker startup or shutdown failed; verify runtime secrets, DEV target and migrations'); process.exitCode = 1; });
}
