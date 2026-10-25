import { execFileSync } from 'node:child_process';
import * as childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDecisionRequest, loadBenchmark, repository } from './fixture';
import { replayJournal, runChainMatchEvaluation } from './run';

const fixture = loadBenchmark();
function journal(limit = fixture.cases.length): { event: string; [key: string]: unknown }[] {
  return [{ event: 'start', benchmarkSha256: fixture.digest, frozenCommit: 'a'.repeat(40) },
    ...fixture.cases.slice(0, limit).flatMap(c => [
      { event: 'request', id: c.id, request: buildDecisionRequest(fixture.benchmark, c) },
      { event: 'response', id: c.id, status: 200, latencyMs: 100, body: JSON.stringify({
        model: 'jev-1.14.0', answers: { chain_item_match: { type: 'choice', choice: c.match ? 'match' : 'no_match',
          confidence: 0.99, probabilities: { match: c.match ? 0.99 : 0.01, no_match: c.match ? 0.01 : 0.99 } } },
        usage: { input_tokens: 700, output_tokens: 10 },
      }) },
    ]), { event: 'end', stopReason: null }];
}
afterEach(() => jest.restoreAllMocks());

test('replay preserves provider decisions, token-accounted cost, latency and incomplete runs', () => {
  const replay = replayJournal(fixture, journal());
  expect(replay.stopReason).toBeNull();
  expect(replay.results).toHaveLength(200);
  expect(replay.results.map(r => r.decision)).toEqual(fixture.cases.map(c => c.match));
  expect(replay.results[0]).toMatchObject({ costUsd: 700 * 0.042 / 1_000_000, latencyMs: 100 });
  expect(replayJournal(fixture, journal(1)).stopReason).toBe('Incomplete evaluation');
  expect(replayJournal(fixture, journal().slice(0, -1)).stopReason).toBe('Incomplete evaluation');
});

test.each([429, 500])('HTTP %i preserves failure, unknown cost and the full test denominator', status => {
  const events = journal(1); Object.assign(events[2]!, { status, body: 'provider error' });
  expect(replayJournal(fixture, events)).toMatchObject({ stopReason: expect.stringContaining('failure'),
    results: [{ id: fixture.cases[0]!.id, decision: null, costUsd: null, latencyMs: 100 }] });
});

test('malformed output and low confidence abstain instead of silently matching or becoming a free negative', () => {
  const events = journal(1);
  Object.assign(events[2]!, { body: 'not JSON' });
  expect(replayJournal(fixture, events).results[0]).toMatchObject({ decision: null, costUsd: null });
  const lowConfidence = journal(1), response = JSON.parse(String(lowConfidence[2]!['body']));
  response.answers.chain_item_match.confidence = 0.5;
  Object.assign(lowConfidence[2]!, { body: JSON.stringify(response) });
  expect(replayJournal(fixture, lowConfidence).results[0]).toMatchObject({ decision: null, costUsd: expect.any(Number) });
});

test('uncertain probabilities abstain and a changing resolved model cannot pass', () => {
  const uncertain = journal(1), response = JSON.parse(String(uncertain[2]!['body']));
  response.answers.chain_item_match = { type: 'choice', choice: 'match', confidence: 0.99, probabilities: { match: 0.8, no_match: 0.2 } };
  Object.assign(uncertain[2]!, { body: JSON.stringify(response) });
  expect(replayJournal(fixture, uncertain).results[0]!.decision).toBeNull();
  const changedModel = journal(), second = JSON.parse(String(changedModel[4]!['body']));
  second.model = 'jev-1.13.0'; Object.assign(changedModel[4]!, { body: JSON.stringify(second) });
  expect(replayJournal(fixture, changedModel).stopReason).toContain('multiple versions');
});

test('protocol mismatches, missing requests, duplicate responses and wrong case order are rejected', () => {
  const changed = journal(1); Object.assign(changed[0]!, { benchmarkSha256: 'b'.repeat(64) });
  expect(() => replayJournal(fixture, changed)).toThrow('identity');
  const original = journal(1);
  expect(() => replayJournal(fixture, [original[0]!, original[2]!, original[3]!])).toThrow('response mismatch');
  expect(() => replayJournal(fixture, [...original.slice(0, 3), original[2]!, original[3]!])).toThrow('response mismatch');
  const swapped = journal(2); [swapped[1], swapped[3]] = [swapped[3]!, swapped[1]!];
  expect(() => replayJournal(fixture, swapped)).toThrow('request mismatch');
  expect(() => replayJournal(fixture, [...original, original[3]!])).toThrow('after completion');
});

test('live mode fails preflight before credentials, files or network when the benchmark is uncommitted', async () => {
  const network = jest.spyOn(globalThis, 'fetch');
  // External Git boundary only: keep this test valid after the benchmark is committed.
  jest.spyOn(childProcess, 'execFileSync').mockImplementation(() => { throw new Error('Uncommitted tree'); });
  await expect(runChainMatchEvaluation(['--mode=live', '--out=/unused-live-output'])).rejects.toThrow('commit the labeled benchmark');
  expect(network).not.toHaveBeenCalled();
});

test('live failure journals requests before sending, retains HTTP output and stops after one attempt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-503-live-test-')), out = join(root, 'failed-run');
  const previousKey = process.env['TYPESAFE_API_KEY']; process.env['TYPESAFE_API_KEY'] = 'synthetic-unit-key';
  // Simulate external Git's committed-byte responses, without creating a commit.
  jest.spyOn(childProcess, 'execFileSync').mockImplementation((_command, argv) => {
    const args = argv as string[];
    if (args[0] === 'diff') return '';
    if (args[0] === 'rev-parse') return 'a'.repeat(40) + '\n';
    if (args[0] === 'show') return readFileSync(join(repository, args[1]!.slice(5)), 'utf8');
    throw new Error('Unexpected Git command');
  });
  const network = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const pending = readFileSync(join(out, 'jev-raw.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(pending.map(e => e.event)).toEqual(['start', 'request']);
    return new Response('synthetic rate-limit response', { status: 429 });
  });
  const costLog = join(repository, 'scripts/eval/results/cost-log.jsonl'), previousLog = readFileSync(costLog, 'utf8');
  try {
    const report = await runChainMatchEvaluation(['--mode=live', `--out=${out}`]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(report.recommendation.decision).toBe('NO-GO');
    expect(report.jev).toMatchObject({ total: 200, attempted: 1, abstained: 200, accuracy: 0, costUsdPer1000: null });
    const raw = readFileSync(join(out, 'jev-raw.jsonl'), 'utf8');
    expect(raw).toContain('synthetic rate-limit response');
    expect(raw).not.toContain('synthetic-unit-key');
    expect(readFileSync(costLog, 'utf8')).toBe(previousLog);
  } finally {
    if (previousKey === undefined) delete process.env['TYPESAFE_API_KEY']; else process.env['TYPESAFE_API_KEY'] = previousKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay creates a reviewable report from raw data, refuses overwrite and makes no network calls', async () => {
  const network = jest.spyOn(globalThis, 'fetch');
  const root = mkdtempSync(join(tmpdir(), 'fitsy-503-replay-'));
  try {
    const input = join(root, 'raw.jsonl'), out = join(root, 'report');
    writeFileSync(input, journal().map(e => JSON.stringify(e)).join('\n') + '\n');
    const report = await runChainMatchEvaluation(['--mode=replay', `--journal=${input}`, `--out=${out}`]);
    expect(report.jev).toMatchObject({ accuracy: 1, falsePositiveRate: 0, recall: 1 });
    expect(report.recommendation.decision).toBe('GO: larger offline evaluation only');
    expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).toBe(readFileSync(input, 'utf8'));
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('p95 ms');
    await expect(runChainMatchEvaluation(['--mode=replay', `--journal=${input}`, `--out=${out}`])).rejects.toThrow('EEXIST');
    expect(network).not.toHaveBeenCalled();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the existing evaluation CLI defaults safely to the real matcher and retains raw baseline outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-503-cli-'));
  try {
    const out = join(root, 'baseline');
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/eval/run-eval.ts', '--decision=chain-match', `--out=${out}`],
      { cwd: repository, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', ANTHROPIC_API_KEY: '' } });
    const report = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(report).toMatchObject({ mode: 'baseline', jev: null, frozenCommit: null, recommendation: { decision: 'NO-GO' },
      baseline: { total: 200, tp: 94, tn: 104, fp: 0, fn: 2, accuracy: 0.99, costUsdPer1000: 0 } });
    expect(JSON.parse(readFileSync(join(out, 'baseline.json'), 'utf8')).results).toHaveLength(200);
    expect(JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).scripts['eval:chain-match'])
      .toBe('node --import tsx scripts/eval/run-eval.ts --decision=chain-match');
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/eval/run-eval.ts', '--decision=unknown'],
      { cwd: repository, stdio: 'pipe' })).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
