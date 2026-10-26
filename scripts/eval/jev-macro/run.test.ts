import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMacroRequest, canAffordRequest, parseJournal, PROTOCOL, protocolSha256, replayJournal,
  requestJevMacros, runEvaluation, type JournalEvent } from './run';
import { loadTruth, repository, type TruthRow } from './truth';

const fixture = loadTruth(), syntheticKey = 'synthetic-jev-unit-key';
const responseFor = (row: TruthRow) => ({ model: 'jev-test-1',
  answers: { calories: { type: 'number', value: row.calories }, protein: { type: 'number', value: row.protein_g },
    carbs: { type: 'number', value: row.carbs_g }, fat: { type: 'number', value: row.fat_g } },
  usage: { input_tokens: 700, output_tokens: 10 } });
function journal(count = fixture.truth.rows.length): JournalEvent[] {
  return [{ event: 'start', truthSha256: fixture.digest, protocolSha256, protocol: PROTOCOL },
    ...fixture.truth.rows.slice(0, count).flatMap(row => [
      { event: 'request', id: row.id, request: buildMacroRequest(row) },
      { event: 'response', id: row.id, status: 200, body: JSON.stringify(responseFor(row)), latencyMs: 100 },
    ]), { event: 'end', stopReason: null }];
}
let previousKey: string | undefined;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jev-macro-test-'));
  previousKey = process.env['TYPESAFE_API_KEY'];
  process.env['TYPESAFE_API_KEY'] = syntheticKey;
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network boundary in test'));
});
afterEach(() => {
  if (previousKey === undefined) delete process.env['TYPESAFE_API_KEY']; else process.env['TYPESAFE_API_KEY'] = previousKey;
  jest.restoreAllMocks(); rmSync(root, { recursive: true, force: true });
});

test('adapter mirrors the endpoint, numeric types, model, auth and five-second no-redirect timeout', async () => {
  const network = jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(responseFor(fixture.truth.rows[0]!)), { status: 200 }));
  const timeout = jest.spyOn(AbortSignal, 'timeout');
  const request = buildMacroRequest(fixture.truth.rows[0]!);
  await requestJevMacros(request, syntheticKey);
  expect(network).toHaveBeenCalledTimes(1);
  expect(network).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', expect.objectContaining({
    method: 'POST', redirect: 'error', body: JSON.stringify(request), signal: expect.any(AbortSignal),
    headers: { Authorization: `Bearer ${syntheticKey}`, 'Content-Type': 'application/json' },
  }));
  expect(timeout).toHaveBeenCalledWith(5000);
  expect(Object.values(request.questions).every(question => question.type === 'number')).toBe(true);
});

test('budget reserves input cost before each request and never treats invalid spend as available', () => {
  const reservation = 16384 * 0.042 / 1_000_000;
  expect(PROTOCOL.maxSpendUsd).toBe(1);
  expect(canAffordRequest(1 - reservation)).toBe(true);
  expect(canAffordRequest(1 - reservation + 1e-9)).toBe(false);
  expect(canAffordRequest(1)).toBe(false);
  expect(canAffordRequest(NaN)).toBe(false);
  expect(canAffordRequest(-1)).toBe(false);
  expect(canAffordRequest(Infinity)).toBe(false);
});

test('full replay retains estimates, cost and original journal without credentials or fetch', async () => {
  delete process.env['TYPESAFE_API_KEY'];
  const input = join(root, 'input.jsonl'), out = join(root, 'replayed');
  const contents = journal().map(event => JSON.stringify(event, null, 0)).join('\n') + '\n';
  writeFileSync(input, contents);
  const report = await runEvaluation([`--journal=${input}`, `--out=${out}`, '--mode=replay']);
  expect(fetch).not.toHaveBeenCalled();
  expect(report.stopReason).toBeNull();
  expect(report.metrics).toMatchObject({ total: 190, successful: 190, failures: 0, catastrophicMissRate: 0,
    medianAbsolutePctError: { calories: 0, protein: 0, carbs: 0, fat: 0 } });
  expect(report.metrics.costUsdPer1000Items).toBeCloseTo(0.0294);
  expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).toBe(contents);
  expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).truthSha256).toBe(fixture.digest);
  const markdown = readFileSync(join(out, 'report.md'), 'utf8');
  expect(markdown).toContain('12.98 | 15.48 | 14.84 | 21.92 | 8/60');
  expect(markdown).toContain('different prompts and inputs');
  expect(markdown).not.toContain(syntheticKey);
  await expect(runEvaluation([`--journal=${input}`, `--out=${out}`, '--mode=replay'])).rejects.toThrow('EEXIST');
});

test('live simulated success makes one request per serving and reproduces replay metrics', async () => {
  let index = 0;
  jest.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(responseFor(fixture.truth.rows[index++]!)), { status: 200 }));
  const liveOut = join(root, 'simulated-live');
  const live = await runEvaluation(['--mode=live', `--out=${liveOut}`]);
  const replay = await runEvaluation(['--mode=replay', `--journal=${join(liveOut, 'jev-raw.jsonl')}`, `--out=${join(root, 'replay')}`]);
  expect(fetch).toHaveBeenCalledTimes(190);
  expect(live.metrics).toEqual(replay.metrics);
  expect(live.stopReason).toBeNull();
});

test.each(['missing', 'negative', 'fractional', 'zero', 'string'])('unknown %s usage stops after one attempt and counts the whole remaining set as misses', async kind => {
  const body: Record<string, unknown> = responseFor(fixture.truth.rows[0]!);
  if (kind === 'missing') delete body['usage'];
  else body['usage'] = { input_tokens: { negative: -1, fractional: 0.5, zero: 0, string: '700' }[kind], output_tokens: 0 };
  jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  const report = await runEvaluation(['--mode=live', `--out=${join(root, 'unknown')}`]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(report.stopReason).toContain('Unknown usage');
  expect(report.metrics).toMatchObject({ failures: 190, catastrophicMissRate: 1, totalCostUsd: null,
    costUsdPer1000Items: null, unknownUsageCount: 1 });
});

test('response shape failure retains known usage and does not retry that item', async () => {
  let index = 0;
  jest.mocked(fetch).mockImplementation(async () => {
    const body = responseFor(fixture.truth.rows[index++]!);
    if (index === 1) body.answers.fat.value = -1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const report = await runEvaluation(['--mode=live', `--out=${join(root, 'invalid-shape')}`]);
  expect(fetch).toHaveBeenCalledTimes(190);
  expect(report.metrics).toMatchObject({ attempted: 190, failures: 1, catastrophicMisses: 1, unknownUsageCount: 0 });
  expect(report.results[0]!.costUsd).toBeCloseTo(700 * 0.042 / 1_000_000);
});

test.each([429, 500])('HTTP %i with no usage retains the raw error and stops', async status => {
  const out = join(root, 'http');
  jest.mocked(fetch).mockResolvedValue(new Response('provider-error-body', { status }));
  const report = await runEvaluation(['--mode=live', `--out=${out}`]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).toContain('provider-error-body');
  expect(report.metrics.totalCostUsd).toBeNull();
});

test('request is durable before transport and transport errors cannot leak the key', async () => {
  const out = join(root, 'timeout');
  jest.mocked(fetch).mockImplementation(async () => {
    expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).toContain('"event":"request"');
    throw new Error(`simulated timeout with Authorization: Bearer ${syntheticKey}`);
  });
  const report = await runEvaluation(['--mode=live', `--out=${out}`]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(report.metrics.totalCostUsd).toBeNull();
  expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).not.toContain(syntheticKey);
});

test('a stalled provider aborts at five seconds and never retries', async () => {
  jest.useFakeTimers();
  try {
    jest.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    jest.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('Simulated abort')));
    }));
    const start = Date.now();
    let settled = false;
    const pending = runEvaluation(['--mode=live', `--out=${join(root, 'stalled')}`]).then(report => { settled = true; return report; });
    await jest.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const report = await pending;
    expect(report.stopReason).toContain('Unknown usage');
    expect(Date.now() - start).toBe(5000);
    expect(report.results[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('a provider credential echo is redacted and stops without exposing it in any artifact', async () => {
  const out = join(root, 'redacted');
  jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...responseFor(fixture.truth.rows[0]!), detail: syntheticKey }), { status: 200 }));
  const report = await runEvaluation(['--mode=live', `--out=${out}`]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(report.stopReason).toContain('credential');
  for (const name of ['jev-raw.jsonl', 'summary.json', 'report.md']) expect(readFileSync(join(out, name), 'utf8')).not.toContain(syntheticKey);
});

test('usage beyond the reserved envelope halts and preserves actual reported spend', async () => {
  const body = responseFor(fixture.truth.rows[0]!); body.usage.input_tokens = 24_000_000;
  jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  const report = await runEvaluation(['--mode=live', `--out=${join(root, 'envelope')}`]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(report.stopReason).toContain('reserved input envelope');
  expect(report.metrics.totalCostUsd).toBeCloseTo(1.008); // Never erase a provider-reported overrun.
});

test('changed models halt with the original provider outputs preserved', async () => {
  let index = 0;
  jest.mocked(fetch).mockImplementation(async () => {
    const body = responseFor(fixture.truth.rows[index++]!); body.model = `jev-test-${index}`;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const report = await runEvaluation(['--mode=live', `--out=${join(root, 'model-drift')}`]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(report.stopReason).toContain('multiple model versions');
});

test('replay refuses changed truth/protocol, leaked truth inputs, duplicate and out-of-order events', () => {
  const original = journal(2);
  expect(() => replayJournal(fixture, [{ ...original[0]!, truthSha256: '0'.repeat(64) }, ...original.slice(1)])).toThrow('identity');
  expect(() => replayJournal(fixture, [{ ...original[0]!, protocolSha256: '0'.repeat(64) }, ...original.slice(1)])).toThrow('identity');
  const changed = journal(1); changed[1]!['request'] = { ...buildMacroRequest(fixture.truth.rows[0]!), truth: 100 };
  expect(() => replayJournal(fixture, changed)).toThrow('request mismatch');
  expect(() => replayJournal(fixture, [original[0]!, original[2]!])).toThrow('response mismatch');
  expect(() => replayJournal(fixture, [...original.slice(0, 3), original[2]!])).toThrow('response mismatch');
  expect(() => replayJournal(fixture, [original[0]!, original[3]!])).toThrow('request mismatch');
  expect(() => replayJournal(fixture, [...original, original[1]!])).toThrow('after end');
});

test('interrupted and torn journals preserve unknown-cost requests and the frozen denominator', async () => {
  const partial = journal(1).slice(0, 2);
  const input = join(root, 'partial.jsonl');
  const contents = partial.map(event => JSON.stringify(event)).join('\n') + '\n{"event":"response"';
  writeFileSync(input, contents);
  const out = join(root, 'partial-replay');
  const report = await runEvaluation(['--mode=replay', `--journal=${input}`, `--out=${out}`]);
  expect(report.metrics).toMatchObject({ total: 190, attempted: 1, failures: 190, totalCostUsd: null });
  expect(report.stopReason).toContain('Incomplete');
  expect(report.results[0]!.latencyMs).toBeNull();
  expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).toBe(contents);
  expect(() => parseJournal(contents + '\n')).toThrow('Malformed complete');
  expect(() => parseJournal('null')).toThrow('Invalid journal event');
  expect(() => parseJournal(journal().map(event => JSON.stringify(event)).join('\n') + '\n{"event":')).toThrow('after end');
});

test('existing live output, oversized prompts, missing key and accidental env input fail before fetch', async () => {
  await expect(runEvaluation(['--mode=live', `--out=${root}`])).rejects.toThrow('EEXIST');
  expect(() => buildMacroRequest({ ...fixture.truth.rows[0]!, description: 'x'.repeat(13000) })).toThrow('12KB');
  expect(() => buildMacroRequest({ ...fixture.truth.rows[0]!, description: 'Contains 640 calories and 38g protein' })).toThrow('nutrition targets');
  await expect(runEvaluation(['--mode=replay', '--journal=.env', `--out=${join(root, 'env')}`])).rejects.toThrow('.jsonl');
  delete process.env['TYPESAFE_API_KEY'];
  await expect(runEvaluation(['--mode=live', `--out=${join(root, 'no-key')}`])).rejects.toThrow('TYPESAFE_API_KEY');
  expect(fetch).not.toHaveBeenCalled();
});

test('real npm replay entrypoint succeeds with the external network boundary disabled', () => {
  const input = join(root, 'entry.jsonl'), out = join(root, 'entry-out'), guard = join(root, 'offline.cjs');
  writeFileSync(input, journal().map(event => JSON.stringify(event)).join('\n') + '\n');
  writeFileSync(guard, "globalThis.fetch = () => { throw new Error('Network forbidden in replay'); };\n");
  const stdout = execFileSync('npm', ['run', 'eval:jev-macro', '-w', 'scripts', '--', '--mode=replay', `--journal=${input}`, `--out=${out}`], {
    cwd: repository, encoding: 'utf8', env: { PATH: process.env['PATH'], NODE_OPTIONS: `--require=${guard}` },
  });
  expect(stdout).toContain('"successful":190');
  expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).metrics.failures).toBe(0);
});
