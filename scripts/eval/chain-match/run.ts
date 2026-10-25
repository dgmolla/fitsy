import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildChainMatcher } from '../../../apps/api/services/chainCatalog';
import { parseJevDecision, requestJevDecision } from '../../../apps/api/services/jevDecisionService';
import { COST_CONFIG } from '../cost-config';
import { appendCostLog, getMonthlySpend } from '../lib/costs';
import { assertCommittedBenchmark, buildDecisionRequest, loadBenchmark, type Fixture } from './fixture';
import { formatReport, recommend, scoreDecisions, type DecisionResult } from './score';

interface JournalEvent { event: string; [key: string]: unknown }
function resultFromResponse(fixture: Fixture, id: string, status: number, body: string, latencyMs: number): DecisionResult & { modelReturned: string } {
  if (status !== 200) throw new Error(`Provider HTTP ${status}; no retries`);
  const response = parseJevDecision(body), answer = response.answers.chain_item_match;
  const t = fixture.benchmark.thresholds;
  const decision = answer.confidence < t.confidence ? null
    : answer.choice === 'match' && answer.probabilities.match >= t.matchProbability ? true
      : answer.choice === 'no_match' && answer.probabilities.match <= t.noMatchProbability ? false : null;
  return { id, decision, latencyMs, modelReturned: response.model,
    costUsd: response.usage.input_tokens * fixture.benchmark.pricing.inputUsdPerMillion / 1_000_000 };
}

/** Re-score raw outputs against the original labels and protocol. Partial or malformed runs fail closed. */
export function replayJournal(fixture: Fixture, events: JournalEvent[]) {
  const first = events[0];
  if (first?.event !== 'start' || first['benchmarkSha256'] !== fixture.digest
    || typeof first['frozenCommit'] !== 'string' || !/^[a-f0-9]{40}$/.test(first['frozenCommit'])) throw new Error('Journal protocol identity mismatch');
  const results: DecisionResult[] = [];
  const models = new Set<string>();
  let pending: string | null = null, stopReason: string | null = null, ended = false;
  for (const [index, event] of events.entries()) {
    if (index === 0) continue;
    if (ended) throw new Error('Journal contains events after completion');
    if (event.event === 'request') {
      const item = fixture.cases[results.length];
      if (pending || stopReason || !item || event['id'] !== item.id
        || JSON.stringify(event['request']) !== JSON.stringify(buildDecisionRequest(fixture.benchmark, item))) throw new Error('Journal request mismatch');
      pending = item.id;
    } else if (event.event === 'response' || event.event === 'error') {
      if (!pending || event['id'] !== pending || typeof event['latencyMs'] !== 'number'
        || !Number.isFinite(event['latencyMs']) || event['latencyMs'] < 0) throw new Error('Journal response mismatch');
      const id = pending, latencyMs = event['latencyMs'];
      try {
        if (event.event === 'error') throw new Error('Transport failure; no retries');
        if (typeof event['status'] !== 'number' || typeof event['body'] !== 'string') throw new Error('Malformed response event');
        const result = resultFromResponse(fixture, id, event['status'], event['body'], latencyMs);
        results.push(result); models.add(result.modelReturned);
      } catch {
        results.push({ id, decision: null, latencyMs, costUsd: null });
        stopReason = 'Provider, transport or response validation failure; raw output retained, no retries';
      }
      pending = null;
    } else if (event.event === 'end') {
      if (event['stopReason'] !== null && typeof event['stopReason'] !== 'string') throw new Error('Invalid completion event');
      stopReason ??= event['stopReason'];
      ended = true;
    } else throw new Error('Unknown journal event');
  }
  if (!ended || pending || results.length !== fixture.cases.length) stopReason ??= 'Incomplete evaluation';
  if (models.size > 1) stopReason ??= 'Model alias resolved to multiple versions during this run';
  return { results, stopReason, frozenCommit: first['frozenCommit'], modelsReturned: [...models] };
}

export async function runChainMatchEvaluation(argv: string[]) {
  const options = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--(mode|out|journal)=(.+)$/.exec(arg);
    if (!match || options.has(match[1]!)) throw new Error('Usage: --decision=chain-match --mode=baseline|live|replay --out=<new-directory> [--journal=<raw.jsonl>]');
    options.set(match[1]!, match[2]!);
  }
  const mode = options.get('mode') ?? 'baseline', output = options.get('out');
  if (!['baseline', 'live', 'replay'].includes(mode) || !output || (mode === 'replay') !== options.has('journal')) throw new Error('Select a valid mode, new output directory, and a journal only for replay');
  const fixture = loadBenchmark();
  // Preflight before credentials, output creation or ANY external request.
  const frozenCommit = mode === 'live' ? assertCommittedBenchmark() : null;
  const apiKey = mode === 'live' ? process.env['TYPESAFE_API_KEY'] : undefined;
  if (mode === 'live' && !apiKey?.trim()) throw new Error('TYPESAFE_API_KEY is required');
  const out = resolve(output);
  mkdirSync(out, { recursive: false, mode: 0o700 });
  const save = (file: string, value: unknown) => writeFileSync(join(out, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const buildStart = performance.now();
  // Index construction is measured separately; the current pipeline builds once per run.
  const indexedMatch = buildChainMatcher(fixture.rows);
  const indexBuildMs = performance.now() - buildStart;
  const baselineResults = fixture.cases.map(item => {
    const start = performance.now();
    const result = indexedMatch(item.item.slug, item.item, { lat: 34, lng: -118 });
    return { id: item.id, decision: result.status === 'matched' && result.row.id === item.candidate,
      latencyMs: performance.now() - start, costUsd: 0,
      raw: { status: result.status, matchedFactId: result.status === 'matched' ? result.row.id : null } };
  });
  // Keep only source-derived matcher decisions, never a second implementation of its normalization.
  writeFileSync(join(out, 'baseline.json'), JSON.stringify({ benchmarkSha256: fixture.digest, indexBuildMs }).slice(0, -1)
    + ',"results":[\n' + baselineResults.map(r => JSON.stringify(r)).join(',\n') + '\n]}\n', { flag: 'wx', mode: 0o600 });
  let jevResults: DecisionResult[] | null = null, stopReason: string | null = null, commit = frozenCommit;
  let modelsReturned: string[] = [];
  if (mode === 'live') {
    const events: JournalEvent[] = [];
    const fd = openSync(join(out, 'jev-raw.jsonl'), 'wx', 0o600);
    const record = (event: JournalEvent) => { appendFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); events.push(event); };
    let spent = 0;
    try {
      record({ event: 'start', timestamp: new Date().toISOString(), benchmarkSha256: fixture.digest, frozenCommit,
        modelRequested: fixture.benchmark.model, pricing: fixture.benchmark.pricing, thresholds: fixture.benchmark.thresholds });
      for (const item of fixture.cases) {
        // Reserve a conservative 16k input-token envelope before every bounded 12KB request.
        const reservation = 16_384 * fixture.benchmark.pricing.inputUsdPerMillion / 1_000_000;
        if (spent + reservation > COST_CONFIG.caps.evalRunMaxUsd || getMonthlySpend() + reservation > COST_CONFIG.caps.monthlyBudgetUsd) {
          stopReason = 'Evaluation or monthly spend cap reached'; break;
        }
        const request = buildDecisionRequest(fixture.benchmark, item);
        record({ event: 'request', id: item.id, request });
        const start = performance.now();
        let response;
        try { response = await requestJevDecision(request, apiKey!); }
        catch {
          record({ event: 'error', id: item.id, latencyMs: performance.now() - start });
          stopReason = 'Transport failure; no retries'; break;
        }
        const latencyMs = performance.now() - start;
        record({ event: 'response', id: item.id, ...response, latencyMs });
        try {
          const result = resultFromResponse(fixture, item.id, response.status, response.body, latencyMs);
          spent += result.costUsd!;
          appendCostLog({ date: new Date().toISOString(), caseName: 'chain-item-match', model: fixture.benchmark.model,
            prompt: fixture.digest, items: 1, costUsd: result.costUsd! });
        } catch { stopReason = 'Provider or response validation failure; no retries'; break; }
      }
      record({ event: 'end', stopReason });
    } finally { closeSync(fd); }
    const replay = replayJournal(fixture, events);
    jevResults = replay.results; stopReason = replay.stopReason; modelsReturned = replay.modelsReturned;
  } else if (mode === 'replay') {
    const contents = readFileSync(options.get('journal')!, 'utf8');
    const events: JournalEvent[] = contents.trim().split('\n').map(line => JSON.parse(line));
    const replay = replayJournal(fixture, events);
    jevResults = replay.results; stopReason = replay.stopReason; commit = replay.frozenCommit; modelsReturned = replay.modelsReturned;
    writeFileSync(join(out, 'jev-raw.jsonl'), contents, { flag: 'wx', mode: 0o600 });
  } else stopReason = 'Baseline only: the labeled set and thresholds must be committed before model calls';
  const baseline = scoreDecisions(fixture.cases, baselineResults);
  const jev = jevResults === null ? null : scoreDecisions(fixture.cases, jevResults);
  const groups = Object.fromEntries(['waba-grill', 'yoshinoya', 'unaliased-positives'].map(group => {
    const labels = fixture.cases.filter(c => group === 'unaliased-positives'
      ? c.match && baselineResults.find(r => r.id === c.id)?.decision === false : c.item.slug === group);
    const ids = new Set(labels.map(c => c.id));
    return [group, { baseline: scoreDecisions(labels, baselineResults.filter(r => ids.has(r.id))),
      jev: jevResults === null ? null : scoreDecisions(labels, jevResults.filter(r => ids.has(r.id))) }];
  }));
  const recommendation = recommend(fixture.benchmark, baseline, jev);
  if (stopReason && jev) { recommendation.decision = 'NO-GO'; recommendation.reasons.push(stopReason); }
  const report = { version: 1, timestamp: new Date().toISOString(), mode, digest: fixture.digest, frozenCommit: commit,
    thresholds: fixture.benchmark.thresholds, pricing: fixture.benchmark.pricing, indexBuildMs, baseline, jev, groups,
    modelsReturned, recommendation, stopReason };
  save('summary.json', report);
  writeFileSync(join(out, 'report.md'), formatReport(report), { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ mode, out, recommendation, baseline, jev }) + '\n');
  return report;
}
