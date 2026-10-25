/** Proposal-only LA census/projection. The live route accepts only the existing production read-only guard. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { auditChainCoverage, readChainCoverageSnapshot } from '../apps/api/services/chainCoverage';
import { chainCatalogBatchSchema } from '../apps/api/services/chainCatalogBatch';
import { stateHash } from '../apps/api/services/chainPilotPlan';
import { prodReadOnlyUrl } from './dev/lib/guard';

const usage = 'Usage: npm run audit:chain-coverage -- <live|snapshot> <snapshot.json> <new-report.json> [--proposal=batch.json] [--target=0.8]';
async function main() {
  const [mode, snapshotPath, reportPath, ...options] = process.argv.slice(2);
  if (!['live', 'snapshot'].includes(mode ?? '') || !snapshotPath || !reportPath
    || options.some(o => !/^--(proposal|target)=.+$/.test(o))
    || new Set(options.map(o => o.split('=')[0])).size !== options.length) throw new Error(usage);
  const proposalPath = options.find(o => o.startsWith('--proposal='))?.slice(11);
  const proposal = proposalPath ? chainCatalogBatchSchema.parse(JSON.parse(readFileSync(proposalPath, 'utf8'))) : undefined;
  const target = options.find(o => o.startsWith('--target='))?.slice(9);
  const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  let snapshot: unknown;
  if (mode === 'live') {
    const url = prodReadOnlyUrl(process.env['PROD_DATABASE_URL']), targetUrl = new URL(url);
    const p = new PrismaClient({ datasources: { db: { url } } });
    try {
      snapshot = await readChainCoverageSnapshot(p, { origin: 'production',
        runtime: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        targetHash: stateHash([targetUrl.host, targetUrl.pathname, targetUrl.username]) });
    } finally { await p.$disconnect(); }
    save(snapshotPath, snapshot);
  } else snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const report = auditChainCoverage(snapshot, proposal, target === undefined ? undefined : Number(target));
  save(reportPath, report);
  process.stdout.write(JSON.stringify({ origin: report.origin, capturedAt: report.capturedAt, applied: false,
    chains: report.chains.length, ...report.totals }) + '\n');
}
void main().catch(error => {
  process.stderr.write((error?.constructor?.name?.startsWith('Prisma') ? 'Read-only database audit failed; inspect connectivity and schema privately.'
    : error instanceof Error ? error.message : 'Coverage audit failed') + '\n');
  process.exitCode = 1;
});
