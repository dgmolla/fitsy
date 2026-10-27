import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseChoiceAnswers, type JevRequest } from '../lib/jev-experiment';
import { choiceMethod } from './adapters';
import { spendState, type ChoiceClient } from './budget';
import { OutputFailure } from './failures';
import { loadCases, sha256, suite } from './fixtures';
import { score } from './metrics';
import { ModelReplayClient } from './providers';
import { requestKey } from './replay';
import { evaluateCase } from './run';
import type { Result } from './types';

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

/** Secondary diagnostic only. Invalid shapes, negative values and zero totals are never invented away. */
export function normalizedAnswers(request: JevRequest, raw: unknown) {
  const copy = structuredClone(raw) as { answers: Record<string, { choice: string; probabilities: Record<string, number> }> };
  for (const [name, question] of Object.entries(request.questions)) {
    const answer = copy.answers[name]!, names = Object.keys(question.criteria), probabilities = answer.probabilities;
    assert.deepEqual(Object.keys(probabilities).sort(), [...names].sort());
    assert(Object.values(probabilities).every(p => Number.isFinite(p) && p >= 0 && p <= 1));
    const sum = Object.values(probabilities).reduce((n, p) => n + p, 0);
    assert(sum > 0);
    for (const key of names) probabilities[key] = probabilities[key]! / sum;
    // Deterministic ties use the original criterion order.
    answer.choice = names.reduce((best, key) => probabilities[key]! > probabilities[best]! ? key : best, names[0]!);
  }
  parseChoiceAnswers(request, copy);
  return copy;
}

export function probabilityChecks(request: JevRequest, raw: unknown) {
  const answers = (raw as { answers: Record<string, { choice: string; probabilities: Record<string, number> }> }).answers;
  return Object.entries(request.questions).map(([name, question]) => {
    const answer = answers[name]!, names = Object.keys(question.criteria), values = names.map(key => answer.probabilities[key]!);
    const sum = values.reduce((n, p) => n + p, 0), maximum = Math.max(...values), chosen = answer.probabilities[answer.choice]!;
    return { name, sum, sumDeviation: sum - 1, absoluteSumDeviation: Math.abs(sum - 1),
      invalidTotal: Math.abs(sum - 1) > .01 + names.length * Number.EPSILON,
      choice: answer.choice, chosenProbability: chosen, maximumProbability: maximum,
      argmaxGap: maximum - chosen, exactArgmaxMismatch: chosen < maximum,
      invalidArgmax: chosen < maximum - .02 };
  });
}

/** Reconstruct only the baseline's consumed requests; a changed refinement must already be cached. */
export async function diagnose(baselineId: string, outputName = 'haiku-format-preflight') {
  assert.match(baselineId, /^[a-zA-Z0-9_-]+$/); assert.match(outputName, /^[a-zA-Z0-9_-]+$/);
  const directory = join(suite, 'results'), baseline = join(directory, baselineId), out = join(directory, outputName);
  assert(!existsSync(out), 'Diagnostic output already exists');
  const metadata = json(join(baseline, 'run.json')), before: Result[] = lines(join(baseline, 'predictions.jsonl'));
  assert.equal(metadata.config.split, 'dev');
  assert.deepEqual(metadata.selectionIds, json(join(suite, 'sources/haiku-qwen-dev-sample.json')).caseIds);
  // Validate full original request/response/billing provenance before interpreting raw cached bodies.
  new ModelReplayClient('haiku', 'diagnosis', directory, join(out, 'unused.jsonl'));
  const ledger = readFileSync(join(directory, 'spend.jsonl')), state = spendState(join(directory, 'spend.jsonl'));
  assert(!state.unknown && !state.pending && state.knownUsd < 2.7);
  const rawByKey = new Map<string, { request: JevRequest; raw: unknown }>(), diagnostics = [];
  for (const reuse of lines(join(baseline, 'haiku-exchanges.jsonl'))) {
    assert.equal(reuse.event, 'reuse');
    const entries = lines(join(directory, reuse.sourceRunId, 'haiku-exchanges.jsonl'));
    const request = entries.find(e => e.event === 'request' && e.requestId === reuse.sourceRequestId);
    const response = entries.find(e => e.event === 'response' && e.requestId === reuse.sourceRequestId);
    assert(request && response && response.status === 200);
    const envelope = JSON.parse(response.body), raw = JSON.parse(envelope.content.map((c: { text: string }) => c.text).join(''));
    assert.equal(envelope.stop_reason, 'end_turn');
    rawByKey.set(requestKey(request.request), { request: request.request, raw });
    if (response.failure) diagnostics.push({ caseId: reuse.context.slice('haiku/'.length), requestId: request.requestId,
      runId: request.runId, stage: 'match' in request.request.questions ? 'matching' : JSON.stringify(request.request.questions).includes('"overflow"') ? 'coarse' : 'fine',
      completedJson: true, checks: probabilityChecks(request.request, raw) });
  }
  const failed = before.filter(r => r.method === 'haiku' && r.failure);
  assert.equal(failed.length, 33); assert.equal(new Set(diagnostics.map(d => d.caseId)).size, failed.length);
  const checks = diagnostics.flatMap(d => d.checks), invalid = checks.filter(c => c.invalidTotal || c.invalidArgmax);
  const sums = checks.filter(c => c.invalidTotal).map(c => c.sum), gaps = checks.filter(c => c.invalidArgmax).map(c => c.argmaxGap);
  const counts = { failedCases: failed.length, completedJson: diagnostics.length, questionCount: checks.length,
    invalidQuestions: invalid.length, invalidTotals: sums.length, invalidArgmax: gaps.length,
    exactArgmaxMismatch: checks.filter(c => c.exactArgmaxMismatch).length,
    totalOnly: invalid.filter(c => c.invalidTotal && !c.invalidArgmax).length,
    argmaxOnly: invalid.filter(c => !c.invalidTotal && c.invalidArgmax).length,
    both: invalid.filter(c => c.invalidTotal && c.invalidArgmax).length,
    sumRange: [Math.min(...sums), Math.max(...sums)],
    absoluteSumDeviationRange: [Math.min(...sums.map(s => Math.abs(s - 1))), Math.max(...sums.map(s => Math.abs(s - 1)))],
    invalidArgmaxGapRange: [Math.min(...gaps), Math.max(...gaps)] };
  const misses: string[] = [];
  const client: ChoiceClient = { knownUsd: 0, requests: 0, reusedRequests: 0, unknown: false, stopped: null, context: '',
    async send(request) {
      const cached = rawByKey.get(requestKey(request));
      if (!cached) { misses.push(this.context); throw new OutputFailure('adapter', 'Normalized refinement absent from baseline cache; no transport'); }
      this.reusedRequests++;
      return { raw: normalizedAnswers(request, cached.raw), costUsd: 0, latencyMs: 0 };
    } };
  const fixture = loadCases('dev', 'both'), selected = metadata.selectionIds.map((id: string) => fixture.cases.find(c => c.id === id)!);
  const normalized: Result[] = [];
  for (const c of selected) normalized.push(await evaluateCase(c, choiceMethod('haiku', client), fixture.rows, client));
  const scores = Object.fromEntries(['curated', 'bulk'].flatMap(tier => ['matching', 'macro'].map(task => {
    const cases = selected.filter((c: { tier: string; task: string }) => c.tier === tier && c.task === task), ids = new Set(cases.map((c: { id: string }) => c.id));
    return [`${tier}/${task}/haiku`, score(cases, normalized.filter(r => ids.has(r.id)))];
  })));
  mkdirSync(out);
  write(join(out, 'diagnosis.json'), { baselineId, selectionSha256: metadata.selectionSha256,
    ledger: { bytes: ledger.length, sha256: sha256(ledger), ...state }, failedCaseIds: failed.map(r => r.id), counts, diagnostics });
  write(join(out, 'normalized-summary.json'), { view: 'SECONDARY: cache-only renormalization plus exact argmax',
    baselineId, paidRequests: 0, newSpendUsd: 0, normalizedRequests: client.reusedRequests, cacheMissCases: misses, scores });
  writeFileSync(join(out, 'normalized-predictions.jsonl'), normalized.map(r => JSON.stringify(r)).join('\n') + '\n', { flag: 'wx' });
  assert.equal(sha256(readFileSync(join(directory, 'spend.jsonl'))), sha256(ledger));
  write(join(suite, 'sources/haiku-format-failed-dev.json'), { baselineId, caseIds: metadata.selectionIds.filter((id: string) => failed.some(r => r.id === id)) });
  process.stdout.write(JSON.stringify({ outputName, counts, normalizedCacheMisses: misses.length, ledger: state }, null, 2) + '\n');
}

if (require.main === module) diagnose(process.argv[2]!).catch(() => { console.error('Haiku cache diagnosis refused; inspect source and baseline evidence.'); process.exitCode = 1; });
