import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { experimentIdentity, parseJournal, replayExperiment, type JournalEvent } from '../lib/jev-experiment';
import { buildDefaultsRequest, DEFAULTS_QUESTION, defaultsExperiment, defaultsResults, savedFrozenRun } from './defaults';
import { buildDecisionRequest, loadBenchmark, repository } from './fixture';
import { replayJournal, runChainMatchEvaluation } from './run';

const fixture = loadBenchmark(), experiment = defaultsExperiment(fixture);
const frozenFile = join(repository, 'scripts/eval/results/jev-chain-match-2026-10-26/jev-raw.jsonl');
const response = (match: boolean, confidence = 0.1, p = 0.6) => ({ model: 'jev-1.14.0',
  answers: { chain_item_match: { type: 'choice', choice: match ? 'match' : 'no_match', confidence,
    probabilities: { match: match ? p : 1 - p, no_match: match ? 1 - p : p } } },
  usage: { input_tokens: 700, output_tokens: 10 } });
function journal(limit = 200): JournalEvent[] {
  return [{ event: 'start', ...experimentIdentity(experiment) },
    ...fixture.cases.slice(0, limit).flatMap(item => [
      { event: 'request', id: item.id, stage: 1, request: buildDefaultsRequest(fixture, item) },
      { event: 'response', id: item.id, stage: 1, status: 200, latencyMs: 100, body: JSON.stringify(response(item.match)) },
    ]), { event: 'end', stopReason: null }];
}
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jev-defaults-'));
  process.env['TYPESAFE_API_KEY'] = 'synthetic-defaults-key';
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
});
afterEach(() => { delete process.env['TYPESAFE_API_KEY']; jest.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

test('defaults retain all 200 projected states and frozen labels, changing only the question', () => {
  const frozenQuestion = JSON.stringify(fixture.benchmark.question);
  expect(experiment.ids).toEqual(fixture.cases.map(item => item.id));
  for (const item of fixture.cases) {
    const request = buildDefaultsRequest(fixture, item), original = buildDecisionRequest(fixture.benchmark, item);
    expect(request.state).toEqual(original.state);
    expect(request.model).toBe(original.model);
    expect(request.questions.chain_item_match).toBe(DEFAULTS_QUESTION);
    for (const leaked of ['rationale', 'aliases', 'observation', 'baseline']) expect(JSON.stringify(request)).not.toContain(leaked);
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(12_000);
  }
  expect(DEFAULTS_QUESTION.instructions).toContain("chain's standard published default serving");
  expect(DEFAULTS_QUESTION.instructions).toContain('Reject a different protein, sauce, size, portion, dish or recipe');
  expect(DEFAULTS_QUESTION.criteria.no_match).toContain('unresolved alternatives or mixed proteins');
  expect(JSON.stringify(fixture.benchmark.question)).toBe(frozenQuestion);
  expect(fixture.benchmark.question.instructions).toContain('Do not infer an unlisted default');
});

test('primary argmax ignores confidence and probability cutoffs while reporting frozen-threshold abstentions', () => {
  const replay = replayExperiment(experiment, journal()), results = defaultsResults(fixture, replay.exchanges);
  expect(replay.stopReason).toBeNull();
  expect(results.map(result => result.decision)).toEqual(fixture.cases.map(item => item.match));
  expect(results.every(result => result.frozenDecision === null)).toBe(true);
  const events = journal(1), body = response(true, 0, 0.5);
  events[2]!['body'] = JSON.stringify(body);
  expect(defaultsResults(fixture, replayExperiment(experiment, events).exchanges)[0]!.decision).toBe(true);
  body.answers.chain_item_match.choice = 'no_match';
  events[2]!['body'] = JSON.stringify(body);
  expect(defaultsResults(fixture, replayExperiment(experiment, events).exchanges)[0]!.decision).toBe(false);
});

test('frozen threshold diagnostics retain inclusive probability and confidence boundaries', () => {
  const events = journal(2);
  events[2]!['body'] = JSON.stringify(response(true, 0.9, 0.95));
  const negative = response(false, 0.9, 0.95);
  negative.answers.chain_item_match.probabilities = { match: 0.05, no_match: 0.95 };
  events[4]!['body'] = JSON.stringify(negative);
  const results = defaultsResults(fixture, replayExperiment(experiment, events).exchanges);
  expect(results.map(result => result.frozenDecision)).toEqual([true, false]);
});

test('frozen Jev replay reproduces the original NO-GO metrics and separate argmax comparison', () => {
  const frozen = savedFrozenRun(fixture);
  expect(frozen.metrics).toMatchObject({ total: 200, tp: 1, tn: 102, fp: 0, fn: 35, abstained: 62, accuracy: 0.515 });
  expect(frozen.argmax).toMatchObject({ tp: 15, tn: 104, fp: 0, fn: 81, abstained: 0, accuracy: 0.595 });
  expect(() => replayJournal(fixture, journal(1))).toThrow('identity');
  expect(() => replayExperiment(experiment, parseJournal(readFileSync(frozenFile, 'utf8')))).toThrow('identity');
  const wrong = journal(1); wrong[1]!['request'] = buildDecisionRequest(fixture.benchmark, fixture.cases[0]!);
  expect(() => replayExperiment(experiment, wrong)).toThrow('request mismatch');
});

test('full simulated collection compares both decoders, frozen Jev and the real baseline without changing the v1 verdict', async () => {
  const frozenBefore = readFileSync(frozenFile, 'utf8'), costFile = join(repository, 'scripts/eval/results/cost-log.jsonl');
  const costBefore = readFileSync(costFile, 'utf8'), out = join(root, 'simulated'); let index = 0;
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    const pending = parseJournal(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).at(-1)!;
    expect(pending).toMatchObject({ event: 'request', id: fixture.cases[index]!.id, stage: 1 });
    expect(JSON.parse(String(init!.body)).questions.chain_item_match).toEqual(DEFAULTS_QUESTION);
    return new Response(JSON.stringify(response(fixture.cases[index++]!.match)));
  });
  const report = await runChainMatchEvaluation(['--mode=live', '--protocol=defaults', `--out=${out}`]);
  expect(fetch).toHaveBeenCalledTimes(200);
  expect(report).toMatchObject({ exploratory: true, protocolName: 'defaults', stopReason: null,
    jev: { accuracy: 1, recall: 1, falsePositiveRate: 0, abstained: 0 },
    frozenThresholds: { accuracy: 0, abstained: 200 },
    baseline: { accuracy: 0.99, tp: 94, tn: 104, fn: 2 },
    frozen: { verdict: { decision: 'NO-GO' }, metrics: { accuracy: 0.515 } }, recommendation: { decision: 'EXPLORATORY ONLY' } });
  expect(report.jev!.costUsdPer1000).toBeCloseTo(0.0294);
  const markdown = readFileSync(join(out, 'report.md'), 'utf8');
  for (const text of ['EXPLORATORY', 'Saved Jev v1 frozen thresholds', 'Saved Jev v1 argmax', 'Defaults argmax', 'Defaults frozen thresholds', 'matchProbability: 0.95', 'confidence: 0.9', '$0.50']) expect(markdown).toContain(text);
  expect(JSON.parse(readFileSync(join(out, 'baseline.json'), 'utf8')).results).toHaveLength(200);
  const input = join(out, 'jev-raw.jsonl'), replayOut = join(root, 'replayed');
  delete process.env['TYPESAFE_API_KEY'];
  const replay = await runChainMatchEvaluation(['--mode=replay', '--protocol=defaults', `--journal=${input}`, `--out=${replayOut}`]);
  expect(replay.jev).toEqual(report.jev);
  expect(readFileSync(join(replayOut, 'jev-raw.jsonl'), 'utf8')).toBe(readFileSync(input, 'utf8'));
  expect(readFileSync(frozenFile, 'utf8')).toBe(frozenBefore);
  expect(readFileSync(costFile, 'utf8')).toBe(costBefore);
  expect(fetch).toHaveBeenCalledTimes(200);
});

test('actual npm defaults replay runs offline without credentials and reports an incomplete journal with a failing exit', () => {
  const input = join(root, 'input.jsonl'), guard = join(root, 'offline.cjs');
  writeFileSync(input, journal().map(event => JSON.stringify(event)).join('\n') + '\n');
  writeFileSync(guard, "globalThis.fetch = () => { throw new Error('Network forbidden'); };\n");
  const env = { PATH: process.env['PATH'], NODE_OPTIONS: `--require=${guard}` };
  const out = join(root, 'cli');
  const stdout = execFileSync('npm', ['run', 'eval:chain-match', '--', '--protocol=defaults', '--mode=replay', `--journal=${input}`, `--out=${out}`],
    { cwd: repository, encoding: 'utf8', env });
  expect(stdout).toContain('"exploratory":true');
  expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).jev.accuracy).toBe(1);
  writeFileSync(input, journal(1).map(event => JSON.stringify(event)).join('\n') + '\n');
  const partial = join(root, 'partial');
  expect(() => execFileSync('npm', ['run', 'eval:chain-match', '--', '--protocol=defaults', '--mode=replay', `--journal=${input}`, `--out=${partial}`],
    { cwd: repository, stdio: 'pipe', env })).toThrow();
  expect(JSON.parse(readFileSync(join(partial, 'summary.json'), 'utf8')).jev).toMatchObject({ total: 200, attempted: 1, totalCostUsd: null });
});

test('first-response model drift halts without retries, preserving the raw output and full denominator', async () => {
  jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...response(false), model: 'jev-1.15.0' })));
  const out = join(root, 'drift'), report = await runChainMatchEvaluation(['--protocol=defaults', '--mode=live', `--out=${out}`]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(report).toMatchObject({ stopReason: 'Model drift from jev-1.14.0', jev: { total: 200, attempted: 1, abstained: 200, accuracy: 0, totalCostUsd: null } });
  expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).toContain('jev-1.15.0');
});

test('interrupted attempts keep unknown cost and unmeasured latency; unsafe flags and overwrite fail before fetch', async () => {
  const input = join(root, 'interrupted.jsonl'), out = join(root, 'interrupted');
  writeFileSync(input, journal().slice(0, 2).map(e => JSON.stringify(e)).join('\n') + '\n');
  const report = await runChainMatchEvaluation(['--protocol=defaults', '--mode=replay', `--journal=${input}`, `--out=${out}`]);
  expect(report.jev).toMatchObject({ total: 200, attempted: 1, abstained: 200, medianLatencyMs: null, p95LatencyMs: null, costUsdPer1000: null });
  await expect(runChainMatchEvaluation(['--protocol=defaults', '--mode=replay', `--journal=${input}`, `--out=${out}`])).rejects.toThrow('EEXIST');
  for (const args of [['--protocol=unknown'], ['--protocol=defaults', '--protocol=v1'], ['--protocol=defaults', '--mode=replay', '--journal=.env']]) {
    await expect(runChainMatchEvaluation([...args, `--out=${join(root, 'invalid')}`])).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});
