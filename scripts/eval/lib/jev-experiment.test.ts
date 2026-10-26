import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canAfford, collectExperiment, experimentIdentity, JEV_LIMITS, parseChoiceAnswers, parseExperimentArgs,
  parseJournal, replayExperiment, type Experiment, type JournalEvent } from './jev-experiment';

const key = 'synthetic-experiment-key';
const experiment: Experiment = { fixtureSha256: 'a'.repeat(64), ids: ['a', 'b'],
  protocol: { ...JEV_LIMITS, exploratory: true, maxSpendUsd: 0.5, maxRequestsPerItem: 1 },
  nextRequest: (id, previous) => previous.length ? null : { model: 'jev-latest', state: { name: id }, questions: {
    test: { type: 'choice', instructions: 'Choose', criteria: { yes: 'yes', no: 'no' } },
  } }, validate: (request, raw) => { parseChoiceAnswers(request, raw); } };
const response = () => ({ model: 'jev-1.14.0', usage: { input_tokens: 700, output_tokens: 10 },
  answers: { test: { type: 'choice', choice: 'yes', confidence: 0, probabilities: { yes: 0.6, no: 0.4 } } } });
const start = () => ({ event: 'start', ...experimentIdentity(experiment) });
function journal(): JournalEvent[] {
  return [start(), ...experiment.ids.flatMap(id => [
    { event: 'request', id, stage: 1, request: experiment.nextRequest(id, []) },
    { event: 'response', id, stage: 1, status: 200, body: JSON.stringify(response()), latencyMs: 10 },
  ]), { event: 'end', stopReason: null }];
}
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jev-experiment-'));
  process.env['TYPESAFE_API_KEY'] = key;
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
});
afterEach(() => { delete process.env['TYPESAFE_API_KEY']; jest.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

test('budget reserves the full envelope before each attempt and rejects nonfinite accounting', () => {
  const reserve = 16_384 * 0.042 / 1_000_000;
  expect(canAfford(0.5 - reserve, experiment.protocol)).toBe(true);
  expect(canAfford(0.5 - reserve + 0.000001, experiment.protocol)).toBe(false);
  for (const spend of [-1, Infinity, NaN]) expect(canAfford(spend, experiment.protocol)).toBe(false);
  const tiny = { ...experiment, protocol: { ...experiment.protocol, maxSpendUsd: reserve / 2 } };
  expect(() => replayExperiment(tiny, [{ event: 'start', ...experimentIdentity(tiny) }, journal()[1]!])).toThrow('request mismatch');
});

test('valid low-confidence argmax outputs replay with token cost and exact model identity', () => {
  const replay = replayExperiment(experiment, journal());
  expect(replay.stopReason).toBeNull();
  expect(replay.exchanges).toHaveLength(2);
  expect(replay.exchanges[0]).toMatchObject({ failure: null, model: 'jev-1.14.0', latencyMs: 10, costUsd: 700 * .042 / 1e6 });
});

test.each(['usage', 'envelope', 'model', 'typed', 'http', 'redacted'])('%s failure stops before another request and retains billed usage', kind => {
  const events = journal().slice(0, 3), body: Record<string, unknown> = response();
  if (kind === 'usage') delete body['usage'];
  if (kind === 'envelope') body['usage'] = { input_tokens: 24_000_000, output_tokens: 1 };
  if (kind === 'model') body['model'] = 'jev-1.15.0';
  if (kind === 'typed') body['answers'] = {};
  events[2]!['body'] = JSON.stringify(body);
  if (kind === 'http') events[2]!['status'] = 429;
  if (kind === 'redacted') events[2]!['redacted'] = true;
  const replay = replayExperiment(experiment, [...events, { event: 'end', stopReason: null }]);
  expect(replay.stopReason).not.toBeNull();
  expect(replay.exchanges[0]!.failure).not.toBeNull();
  expect(replay.exchanges[0]!.costUsd).toBe(kind === 'usage' ? null : (kind === 'envelope' ? 24_000_000 : 700) * .042 / 1e6);
  expect(() => replayExperiment(experiment, [...events, journal()[3]!])).toThrow('request mismatch');
});

test('strict replay rejects changed selection/protocol, ordering, duplicates, unexpected stages and extra events', () => {
  for (const mutation of [
    (e: JournalEvent[]) => { e[0]!['selectionSha256'] = 'b'.repeat(64); },
    (e: JournalEvent[]) => { e[0]!['protocolSha256'] = 'b'.repeat(64); },
    (e: JournalEvent[]) => { e[1]!['id'] = 'b'; },
    (e: JournalEvent[]) => { e[1]!['stage'] = 2; },
    (e: JournalEvent[]) => { e[1]!['request'] = { ...experiment.nextRequest('a', []), truth: 99 }; },
    (e: JournalEvent[]) => { e.splice(1, 1); },
    (e: JournalEvent[]) => { e.splice(3, 0, e[2]!); },
    (e: JournalEvent[]) => { e.push(e[1]!); },
  ]) {
    const events = journal(); mutation(events);
    expect(() => replayExperiment(experiment, events)).toThrow();
  }
});

test('incomplete and torn journals retain unknown-cost attempts, including the pending request', () => {
  const events = journal().slice(0, 2), bytes = events.map(e => JSON.stringify(e)).join('\n') + '\n{"event":';
  const replay = replayExperiment(experiment, parseJournal(bytes));
  expect(replay).toMatchObject({ stopReason: 'Incomplete evaluation', exchanges: [{ id: 'a', latencyMs: null, costUsd: null, failure: expect.stringContaining('Interrupted') }] });
  expect(() => parseJournal(bytes + '\n')).toThrow('Malformed complete');
  expect(() => parseJournal('null')).toThrow('Invalid journal');
  expect(() => parseJournal(journal().map(e => JSON.stringify(e)).join('\n') + '\n{"event":')).toThrow('after end');
});

test('live simulated HTTP failure journals durably, accounts known usage and never retries', async () => {
  const out = join(root, 'http');
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    expect(parseJournal(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).map(e => e.event)).toEqual(['start', 'request']);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    return new Response(JSON.stringify(response()), { status: 429 });
  });
  const timeout = jest.spyOn(AbortSignal, 'timeout');
  const replay = await collectExperiment(experiment, parseExperimentArgs(['--mode=live', `--out=${out}`]));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(timeout).toHaveBeenCalledWith(5_000);
  expect(replay).toMatchObject({ stopReason: 'HTTP 429', exchanges: [{ costUsd: 700 * .042 / 1e6, failure: 'HTTP 429' }] });
  expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).not.toContain(key);
});

test.each(['transport', 'echo', 'model'])('live simulated %s stops on the first call without leaking credentials', async kind => {
  jest.mocked(fetch).mockImplementation(async () => {
    if (kind === 'transport') throw new Error(`Authorization: Bearer ${key}`);
    return new Response(JSON.stringify({ ...response(), ...(kind === 'echo' ? { detail: key } : { model: 'jev-2.0.0' }) }));
  });
  const out = join(root, kind), replay = await collectExperiment(experiment, parseExperimentArgs(['--mode=live', `--out=${out}`]));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(replay.stopReason).toContain(kind === 'echo' ? 'credential' : kind === 'model' ? 'Model drift' : 'Transport');
  expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).not.toContain(key);
});

test('a stalled provider aborts at five seconds without a retry', async () => {
  jest.useFakeTimers();
  try {
    jest.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal;
    });
    jest.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('simulated timeout')));
    }));
    let settled = false;
    const pending = collectExperiment(experiment, parseExperimentArgs(['--mode=live', `--out=${join(root, 'timeout')}`])).then(r => { settled = true; return r; });
    await jest.advanceTimersByTimeAsync(4999); expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1); expect((await pending).stopReason).toContain('Transport');
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('accidental credential paths, duplicate switches and unknown modes are rejected before reads', () => {
  for (const args of [['--mode=live', '--mode=replay'], ['--mode=defaults'], ['--mode=replay', '--journal=.env'], ['--key=abc']]) {
    expect(() => parseExperimentArgs([...args, '--out=/unused'])).toThrow();
  }
});
