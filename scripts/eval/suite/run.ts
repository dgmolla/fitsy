import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { adapterProtocol, method } from './adapters';
import { JevClient, RESERVATION_USD, STOP_USD, HARD_CAP_USD } from './budget';
import { durableAppend, loadCases, root, sha256, stratifiedSample, suite } from './fixtures';
import { score, table, type Metrics } from './metrics';
import { candidate, macrosSchema, type Case, type Method, type Result, type Tier } from './types';

export class PreflightError extends Error {}

export function options(argv: string[]) {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (arg === '--live' && !flags.has('live')) { flags.set('live', 'true'); continue; }
    const match = /^--(split|tier|methods)=(.+)$/.exec(arg);
    if (!match || flags.has(match[1]!)) throw new Error('Usage: --methods=exact,jev-v3 --split=dev|holdout --tier=curated|bulk|both [--live]');
    flags.set(match[1]!, match[2]!);
  }
  const split = z.enum(['dev', 'holdout']).parse(flags.get('split') ?? 'dev');
  const tier = z.enum(['curated', 'bulk', 'both']).parse(flags.get('tier') ?? 'both');
  const methods = (flags.get('methods') ?? 'exact').split(',');
  if (!methods.length || new Set(methods).size !== methods.length || methods.some(m => !['exact', 'jev-v3', 'haiku', 'qwen'].includes(m))) throw new Error('Invalid method selection');
  if (methods.some(m => m === 'haiku' || m === 'qwen')) throw new Error('Haiku and Qwen are disabled adapter stubs');
  if (methods.includes('jev-v3') !== flags.has('live')) throw new Error('Jev requires explicit --live; --live requires the Jev method');
  return { split, tier, methods, live: flags.has('live') };
}
const matchOutputSchema = z.object({ kind: z.enum(['match', 'none', 'abstain']), matchId: z.string().nullable(), confidence: z.number().finite().min(0).max(1) }).strict();
export async function evaluateCase(c: Case, adapter: Method, rows: ReturnType<typeof loadCases>['rows'], client?: JevClient): Promise<Result> {
  const started = performance.now(), costBefore = client?.knownUsd ?? 0, requestsBefore = client?.requests ?? 0;
  if (client) client.context = `${adapter.name}/${c.id}`;
  let output: Result['output'] = null, failure: string | null = null;
  try {
    if (c.task === 'matching' && adapter.matcher) {
      output = matchOutputSchema.parse(await adapter.matcher.match(c.input, c.candidates.map(id => candidate(rows.find(row => row.id === id)!))));
      if (output.kind === 'match' ? !output.matchId || !c.candidates.includes(output.matchId) : output.matchId !== null) throw new Error('Invalid match identity');
    } else if (c.task === 'macro' && adapter.estimator) {
      const estimated = await adapter.estimator.estimate(c.input);
      output = estimated === null ? null : macrosSchema.parse(estimated);
      if (output === null) failure = 'Estimator abstained or overflowed';
    } else throw new Error('Adapter does not support task');
  } catch { failure = client?.stopped ?? 'Adapter failed or returned an invalid output'; output = null; }
  return { id: c.id, method: adapter.name, output, failure, latencyMs: performance.now() - started,
    costUsd: client?.unknown ? null : (client?.knownUsd ?? 0) - costBefore,
    knownCostUsd: (client?.knownUsd ?? 0) - costBefore, requests: (client?.requests ?? 0) - requestsBefore };
}

export function affordableSelection(cases: Case[], remainingUsd: number) {
  const weight = (c: Case) => c.task === 'macro' ? 2 : 1;
  const curated = cases.filter(c => c.tier === 'curated'), bulk = cases.filter(c => c.tier === 'bulk');
  const capacity = Math.floor((remainingUsd + Number.EPSILON) / RESERVATION_USD);
  const curatedRequests = curated.reduce((n, c) => n + weight(c), 0);
  if (curatedRequests > capacity) throw new Error('Remaining budget cannot reserve the full curated selection');
  if (cases.reduce((n, c) => n + weight(c), 0) <= capacity) return { selected: cases, sampled: false };
  // Stratification is outcome-independent. Reserve the worst-case two requests per sampled case.
  const count = Math.max(0, Math.floor((capacity - curatedRequests) / 2));
  return { selected: [...curated, ...stratifiedSample(bulk, count)], sampled: true };
}
export async function run(argv: string[], directory = suite) {
  const config = options(argv), runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const resultsDirectory = join(directory, 'results'), out = join(resultsDirectory, runId);
  mkdirSync(out, { recursive: true });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const holdoutLog = join(resultsDirectory, 'holdout-runs.jsonl');
  if (config.split === 'holdout') durableAppend(holdoutLog, { event: 'start', at: new Date().toISOString(), runId, head, config });
  let client: JevClient | undefined;
  try {
    const fixture = loadCases(config.split, config.tier, directory);
    if (config.live) {
      if (!process.env['TYPESAFE_API_KEY']?.trim()) throw new PreflightError('TYPESAFE_API_KEY is missing from the invoking environment; no Jev requests were sent.');
      // Freeze all executing source and data before spending. Result artifacts may be untracked.
      execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'scripts/eval/suite', ':(exclude)scripts/eval/suite/results',
        'scripts/eval/lib/jev-experiment.ts', 'scripts/eval/jev-macro'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      execFileSync('git', ['cat-file', '-e', 'HEAD:scripts/eval/suite/run.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'scripts/eval/suite',
        ':(exclude)scripts/eval/suite/results'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (untracked.trim()) throw new Error('Uncommitted suite input');
      client = new JevClient(runId, resultsDirectory, out, process.env['TYPESAFE_API_KEY'] ?? '');
    }
    const selection = client ? affordableSelection(fixture.cases, client.remainingUsd) : { selected: fixture.cases, sampled: false };
    const selected = selection.selected, results: Result[] = [], scores: Record<string, Metrics> = {};
    const metadata = { version: 1, runId, head, config, checksum: fixture.checksum, fixtureSha256: fixture.fixtureSha256,
      protocolSha256: sha256(JSON.stringify(adapterProtocol)), protocol: adapterProtocol, sampled: selection.sampled,
      population: fixture.cases.length, selected: selected.length, selectionIds: selected.map(c => c.id),
      selectionSha256: sha256(JSON.stringify(selected.map(c => c.id))), budget: { stopUsd: STOP_USD, hardCapUsd: HARD_CAP_USD, reservationPerPostUsd: RESERVATION_USD } };
    writeFileSync(join(out, 'run.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
    for (const name of config.methods) {
      const adapter = method(name, client);
      for (const tier of (config.tier === 'both' ? ['curated', 'bulk'] : [config.tier]) as Tier[]) {
        for (const task of ['matching', 'macro'] as const) {
          if (task === 'matching' ? !adapter.matcher : !adapter.estimator) continue;
          const cases = selected.filter(c => c.tier === tier && c.task === task);
          const partial: Result[] = [];
          for (const c of cases) {
            if (name === 'jev-v3' && client?.stopped) break;
            const result = await evaluateCase(c, adapter, fixture.rows, name === 'jev-v3' ? client : undefined);
            durableAppend(join(out, 'predictions.jsonl'), result);
            partial.push(result); results.push(result);
            if (partial.length % 100 === 0) process.stdout.write(`${name} ${tier}/${task}: ${partial.length}/${cases.length}; cumulative known Jev $${client?.knownUsd.toFixed(6) ?? '0'}\n`);
          }
          scores[`${tier}/${task}/${name}`] = score(cases, partial);
        }
      }
    }
    const report = { ...metadata, stopReason: client?.stopped ?? null, scores,
      accounting: { cumulativeKnownUsd: client?.knownUsd ?? 0, requests: client?.requests ?? 0,
        runKnownUsd: results.reduce((sum, result) => sum + (result.knownCostUsd ?? result.costUsd ?? 0), 0), unknownUsage: client?.unknown ?? false } };
    const markdown = `**TL;DR:** ${config.split} ${config.tier} evaluation ${report.stopReason ? 'stopped with failures' : 'completed'}; ${selected.length} selected cases.\n\n`
      + table(scores) + '\nMatching pass requires exact ID/NO MATCH; abstentions fail.\n'
      + 'Macro pass requires every macro error <=25%; exact zero is required against zero truth.\n'
      + 'Big miss is strictly >50% calorie error; failures and omissions count as misses and infinite error.\n'
      + 'Medians include failures; unavailable medians display as a dash.\n'
      + 'Cost/1k divides billed attempts by attempted cases, including both estimator stages.\n'
      + 'Repeated UE candidate pairs are correlated; these are case counts, not independent meals.\n'
      + `Cumulative known Jev spend: $${report.accounting.cumulativeKnownUsd.toFixed(8)}; run known spend: $${report.accounting.runKnownUsd.toFixed(8)}; unknown usage: ${report.accounting.unknownUsage}.\n`;
    writeFileSync(join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(join(out, 'report.md'), markdown, { flag: 'wx' });
    if (config.split === 'holdout') durableAppend(holdoutLog, { event: 'end', at: new Date().toISOString(), runId, head,
      checksum: fixture.checksum, selectionSha256: metadata.selectionSha256, status: report.stopReason ? 'partial' : 'complete', out });
    process.stdout.write(markdown + '\n');
    process.stdout.write(`Results: ${out}\n`);
    return report;
  } catch (error) {
    const failure = error instanceof PreflightError ? error.message
      : 'Evaluation failed; inspect fixtures, explicit live credentials, budget ledger and source cleanliness. No automatic retry.';
    writeFileSync(join(out, 'failure.json'), JSON.stringify({ runId, head, config, failure, at: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
    if (config.split === 'holdout') durableAppend(holdoutLog, { event: 'end', at: new Date().toISOString(), runId, head, status: 'failed-preflight-or-execution' });
    throw new PreflightError(failure);
  } finally { client?.close(); }
}
if (require.main === module) run(process.argv.slice(2)).then(report => {
  if (report.stopReason) process.exitCode = 1;
}).catch(error => { console.error(error instanceof PreflightError ? error.message : 'Invalid evaluation options; no execution started.'); process.exitCode = 1; });
