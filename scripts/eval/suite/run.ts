import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { adapterProtocol, coarseRequest, refinementRequest, matchingRequest, method } from './adapters';
import { JevClient, RESERVATION_USD, STOP_USD, HARD_CAP_USD, spendState, type ChoiceClient } from './budget';
import { ReplayClient } from './replay';
import { ModelClient, ModelSession, MODEL_STOP_USD, MODEL_HARD_CAP_USD, providers, reservation, type Provider } from './providers';
import { durableAppend, loadCases, root, sha256, stratifiedSample, suite } from './fixtures';
import { score, table, type Metrics } from './metrics';
import { candidate, macrosSchema, type Case, type Method, type Result, type Tier } from './types';
import type { JevRequest } from '../lib/jev-experiment';

export class PreflightError extends Error {}

export function options(argv: string[]) {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (['--live', '--replay-only'].includes(arg) && !flags.has(arg.slice(2))) { flags.set(arg.slice(2), 'true'); continue; }
    const match = /^--(split|tier|methods|cases)=(.+)$/.exec(arg);
    if (!match || flags.has(match[1]!)) throw new Error('Usage: --methods=exact,jev-v3 --split=dev|holdout --tier=curated|bulk|both [--cases=source-relative.json] [--live] [--replay-only]');
    flags.set(match[1]!, match[2]!);
  }
  const split = z.enum(['dev', 'holdout']).parse(flags.get('split') ?? 'dev');
  const tier = z.enum(['curated', 'bulk', 'both']).parse(flags.get('tier') ?? 'both');
  const methods = (flags.get('methods') ?? 'exact').split(',');
  if (!methods.length || new Set(methods).size !== methods.length || methods.some(m => !['exact', 'jev-v3', 'haiku', 'qwen'].includes(m))) throw new Error('Invalid method selection');
  const paid = methods.some(m => m !== 'exact');
  if (paid !== flags.has('live')) throw new Error('Provider methods require explicit --live; --live requires a provider method');
  if (flags.has('replay-only') && (!methods.includes('jev-v3') || methods.some(m => m === 'haiku' || m === 'qwen'))) throw new Error('--replay-only selects Jev without paid adapters');
  if (split !== 'dev' && methods.some(m => m === 'haiku' || m === 'qwen')) throw new Error('Haiku/Qwen execution is dev-only');
  const cases = flags.get('cases');
  if (cases && (split !== 'dev' || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/.test(cases))) throw new Error('Explicit case selection is dev-only and relative to suite sources');
  return { split, tier, methods, live: flags.has('live'), jevReplayOnly: flags.has('replay-only') || methods.some(m => m === 'haiku' || m === 'qwen'), ...(cases ? { cases } : {}) };
}
export function requestedSelection(cases: Case[], file: string | undefined, directory = suite) {
  if (!file) return { cases, source: null };
  const bytes = readFileSync(join(directory, 'sources', file), 'utf8');
  const ids = z.object({ caseIds: z.array(z.string().min(1)).min(1) }).parse(JSON.parse(bytes)).caseIds;
  const allowed = new Set(cases.map(c => c.id));
  if (new Set(ids).size !== ids.length || ids.some(id => !allowed.has(id))) throw new Error('Selected IDs must be unique and belong to the requested dev tier');
  const byId = new Map(cases.map(c => [c.id, c]));
  return { cases: ids.map(id => byId.get(id)!), source: { file, sha256: sha256(bytes) } };
}
const matchOutputSchema = z.object({ kind: z.enum(['match', 'none', 'abstain']), matchId: z.string().nullable(), confidence: z.number().finite().min(0).max(1) }).strict();
export async function evaluateCase(c: Case, adapter: Method, rows: ReturnType<typeof loadCases>['rows'], client?: ChoiceClient): Promise<Result> {
  const started = performance.now(), costBefore = client?.knownUsd ?? 0, requestsBefore = client?.requests ?? 0,
    reusedBefore = client?.reusedRequests ?? 0;
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
    knownCostUsd: (client?.knownUsd ?? 0) - costBefore, requests: (client?.requests ?? 0) - requestsBefore,
    reusedRequests: (client?.reusedRequests ?? 0) - reusedBefore };
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
/** Bound both providers and both estimator stages before choosing an outcome-independent common sample. */
export function modelSelection(cases: Case[], rows: ReturnType<typeof loadCases>['rows'], remainingUsd: number, selectedProviders: Provider[],
  replayed: (provider: Provider, request: JevRequest) => boolean = () => false) {
  const cost = new Map(cases.map(c => {
    const requests = c.task === 'matching' ? [matchingRequest(c.input, c.candidates.map(id => candidate(rows.find(r => r.id === id)!)))]
      : [coarseRequest(c.input), refinementRequest(coarseRequest(c.input).state,
        Object.fromEntries(['calories', 'protein', 'carbs', 'fat'].map(m => [m, { choice: 'b11' }])) )];
    return [c.id, selectedProviders.reduce((sum, provider) => sum + requests.reduce((n, r) => n + (replayed(provider, r) ? 0 : reservation(provider, r).usd), 0), 0)];
  }));
  const bound = (selection: Case[]) => selection.reduce((sum, c) => sum + cost.get(c.id)!, 0);
  if (bound(cases) <= remainingUsd) return { selected: cases, sampled: false, reservedUpperBoundUsd: bound(cases), fullUpperBoundUsd: bound(cases) };
  let lo = 0, hi = cases.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bound(stratifiedSample(cases, mid)) <= remainingUsd) lo = mid; else hi = mid - 1;
  }
  if (!lo) throw new Error('Remaining budget cannot reserve one common sampled case');
  const selected = stratifiedSample(cases, lo);
  return { selected, sampled: true, reservedUpperBoundUsd: bound(selected), fullUpperBoundUsd: bound(cases) };
}
export async function run(argv: string[], directory = suite) {
  const config = options(argv), runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const resultsDirectory = join(directory, 'results'), out = join(resultsDirectory, runId);
  mkdirSync(out, { recursive: true });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const holdoutLog = join(resultsDirectory, 'holdout-runs.jsonl');
  if (config.split === 'holdout') durableAppend(holdoutLog, { event: 'start', at: new Date().toISOString(), runId, head, config });
  let client: JevClient | ReplayClient | undefined, modelSession: ModelSession | undefined;
  const modelClients = new Map<Provider, ModelClient>();
  try {
    const fixture = loadCases(config.split, config.tier, directory);
    const requested = requestedSelection(fixture.cases, config.cases, directory);
    if (config.live) {
      const missing = config.methods.filter((m): m is Provider => m === 'haiku' || m === 'qwen')
        .map(m => providers[m].key).filter(key => !process.env[key]?.trim());
      if (missing.length) {
        const aliases: Record<string, string> = { ANTHROPIC_API_KEY: 'anthropic', OPENROUTER_API_KEY: 'openrouter' };
        const hints = missing.filter(key => process.env[aliases[key]!]?.trim()).map(key => `${aliases[key]} -> ${key}`);
        throw new PreflightError(`Missing process credentials: ${missing.join(', ')}. Load only these keys from the authorized env files in memory; no requests were sent.${hints.length ? ` Legacy names present; export in the invoking shell: ${hints.join(', ')}.` : ''}`);
      }
      if (config.methods.includes('jev-v3') && !config.jevReplayOnly && !process.env['TYPESAFE_API_KEY']?.trim()) throw new PreflightError(process.env['jev']?.trim()
        ? 'TYPESAFE_API_KEY is missing; a legacy Jev variable named jev is present. Export it as TYPESAFE_API_KEY in the invoking shell; no requests were sent.'
        : 'TYPESAFE_API_KEY is missing from the invoking environment; no Jev requests were sent.');
      // Freeze all executing source and data before spending. Result artifacts may be untracked.
      execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'scripts/eval/suite', ':(exclude)scripts/eval/suite/results',
        'scripts/eval/lib/jev-experiment.ts', 'scripts/eval/jev-macro'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      execFileSync('git', ['cat-file', '-e', 'HEAD:scripts/eval/suite/run.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'scripts/eval/suite',
        ':(exclude)scripts/eval/suite/results'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (untracked.trim()) throw new Error('Uncommitted suite input');
      const selectedProviders = config.methods.filter((m): m is Provider => m === 'haiku' || m === 'qwen');
      if (selectedProviders.length) {
        modelSession = new ModelSession(runId, resultsDirectory);
        for (const provider of selectedProviders) modelClients.set(provider,
          new ModelClient(provider, modelSession, out, process.env[providers[provider].key] ?? ''));
      }
      if (config.methods.includes('jev-v3')) client = config.jevReplayOnly
        ? new ReplayClient(runId, resultsDirectory, join(out, 'jev-exchanges.jsonl'))
        : new JevClient(runId, resultsDirectory, out, process.env['TYPESAFE_API_KEY'] ?? '');
    }
    const selection = modelSession ? modelSelection(requested.cases, fixture.rows, modelSession.remainingUsd, [...modelClients.keys()],
      (provider, request) => modelClients.get(provider)!.hasReplay(request))
      : client instanceof JevClient ? affordableSelection(requested.cases, client.remainingUsd) : { selected: requested.cases, sampled: false };
    if (modelSession && config.cases && selection.sampled) throw new PreflightError('The fixed paid-model selection does not fit the remaining budget; no cases may be silently dropped.');
    const selected = selection.selected, results: Result[] = [], scores: Record<string, Metrics> = {};
    const metadata = { version: 1, runId, head, config, checksum: fixture.checksum, fixtureSha256: fixture.fixtureSha256,
      protocolSha256: sha256(JSON.stringify(adapterProtocol)), protocol: adapterProtocol, providers: modelClients.size ? providers : null, sampled: selection.sampled,
      population: fixture.cases.length, eligiblePopulation: requested.cases.length, selectionSource: requested.source,
      selected: selected.length, selectionIds: selected.map(c => c.id),
      selectionSha256: sha256(JSON.stringify(selected.map(c => c.id))), budget: modelSession
        ? { stopUsd: MODEL_STOP_USD, hardCapUsd: MODEL_HARD_CAP_USD, priorModelSpendUsd: modelSession.modelKnownUsd,
          reservedUpperBoundUsd: 'reservedUpperBoundUsd' in selection ? selection.reservedUpperBoundUsd : null,
          fullUpperBoundUsd: 'fullUpperBoundUsd' in selection ? selection.fullUpperBoundUsd : null }
        : { stopUsd: STOP_USD, hardCapUsd: HARD_CAP_USD, reservationPerPostUsd: RESERVATION_USD } };
    writeFileSync(join(out, 'run.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
    for (const name of config.methods) {
      const tracked = name === 'jev-v3' ? client : modelClients.get(name as Provider);
      const adapter = method(name, tracked);
      for (const tier of (config.tier === 'both' ? ['curated', 'bulk'] : [config.tier]) as Tier[]) {
        for (const task of ['matching', 'macro'] as const) {
          if (task === 'matching' ? !adapter.matcher : !adapter.estimator) continue;
          const cases = selected.filter(c => c.tier === tier && c.task === task);
          const partial: Result[] = [];
          for (const c of cases) {
            if (tracked?.stopped) break;
            const result = await evaluateCase(c, adapter, fixture.rows, tracked);
            durableAppend(join(out, 'predictions.jsonl'), result);
            partial.push(result); results.push(result);
            if (partial.length % 100 === 0) process.stdout.write(`${name} ${tier}/${task}: ${partial.length}/${cases.length}; ${modelSession ? `known new-model $${modelSession.modelKnownUsd.toFixed(6)}` : client ? `run Jev $${client.knownUsd.toFixed(6)}` : 'deterministic run cost $0'}\n`);
          }
          scores[`${tier}/${task}/${name}`] = score(cases, partial);
        }
      }
    }
    const report = { ...metadata, stopReason: modelSession?.stopped ?? client?.stopped ?? null, scores,
      accounting: { cumulativeKnownUsd: config.live ? spendState(join(resultsDirectory, 'spend.jsonl')).knownUsd : null,
        requests: (client?.requests ?? 0) + [...modelClients.values()].reduce((n, c) => n + c.requests, 0),
        reusedRequests: (client?.reusedRequests ?? 0) + [...modelClients.values()].reduce((n, c) => n + c.reusedRequests, 0),
        runKnownUsd: results.reduce((sum, result) => sum + (result.knownCostUsd ?? result.costUsd ?? 0), 0), unknownUsage: modelSession?.unknown ?? client?.unknown ?? false } };
    const markdown = `**TL;DR:** ${config.split} ${config.tier} evaluation ${report.stopReason ? 'stopped with failures' : 'completed'}; ${selected.length} selected cases.\n\n`
      + table(scores) + '\nMatching pass requires exact ID/NO MATCH; abstentions fail.\n'
      + 'Macro pass requires every macro error <=25%; exact zero is required against zero truth.\n'
      + 'Big miss is strictly >50% calorie error; failures and omissions count as misses and infinite error.\n'
      + 'Medians include failures; unavailable medians display as a dash.\n'
      + 'Cost/1k divides billed attempts by attempted cases, including both estimator stages.\n'
      + 'Repeated UE candidate pairs are correlated; these are case counts, not independent meals.\n'
      + `Replayed identical paid requests: ${report.accounting.reusedRequests}; replay incurs no new charge. Latency includes replay reads.\n`
      + (report.accounting.cumulativeKnownUsd === null ? 'Cumulative provider spend is not reported by this offline run.\n'
        : `Cumulative known provider spend: $${report.accounting.cumulativeKnownUsd.toFixed(8)}.\n`)
      + `Run known spend: $${report.accounting.runKnownUsd.toFixed(8)}; unknown usage: ${report.accounting.unknownUsage}.\n`;
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
  } finally { if (client instanceof JevClient) client.close(); modelClients.forEach(c => c.close()); modelSession?.close(); }
}
if (require.main === module) run(process.argv.slice(2)).then(report => {
  if (report.stopReason) process.exitCode = 1;
}).catch(error => { console.error(error instanceof PreflightError ? error.message : 'Invalid evaluation options; no execution started.'); process.exitCode = 1; });
