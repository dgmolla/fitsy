import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMacroRequest, canAffordRequest, parseJournal, PROTOCOL, protocolSha256, replayJournal,
  requestJevMacros, runEvaluation, type JournalEvent } from './run';
import { loadTruth, repository, sha256, type TruthRow } from './truth';

const fixture = loadTruth(), syntheticKey = 'synthetic-jev-unit-key';
function choiceAnswer(value: number, width: number, limit: number, prefix: string) {
  const lower = Math.min(Math.floor(value / width) * width, limit);
  const choice = lower === limit ? `${prefix}_${limit}_plus` : `${prefix}_${lower}_${lower + width}`;
  const probabilities = Object.fromEntries(Array.from({ length: limit / width + 1 }, (_, index) => {
    const edge = index * width, name = edge === limit ? `${prefix}_${limit}_plus` : `${prefix}_${edge}_${edge + width}`;
    return [name, name === choice ? 1 : 0];
  }));
  return { type: 'choice' as const, choice, confidence: 1, probabilities };
}
const responseFor = (row: TruthRow) => ({ model: 'jev-test-1',
  answers: { calories: choiceAnswer(row.calories, 25, 2500, 'kcal'), protein: choiceAnswer(row.protein_g, 2, 200, 'g'),
    carbs: choiceAnswer(row.carbs_g, 2, 200, 'g'), fat: choiceAnswer(row.fat_g, 2, 200, 'g') },
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

test('collection satisfies the System One choice-question contract at the provider boundary', async () => {
  let index = 0;
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init!.body));
    const supported = Object.values(request.questions).every(question => {
      const candidate = question as { type: string; criteria?: Record<string, string> };
      return candidate.type === 'choice' && Object.keys(candidate.criteria ?? {}).length === 101;
    });
    return supported
      ? new Response(JSON.stringify(responseFor(fixture.truth.rows[index++]!)), { status: 200 })
      : new Response(JSON.stringify({ detail: { error_type: 'api_usage_error', message: 'Invalid request.' } }), { status: 400 });
  });
  const report = await runEvaluation(['--mode=live', `--out=${join(root, 'system-one-contract')}`]);
  expect(report.stopReason).toBeNull();
  expect(report.metrics.successful).toBe(190);
  expect(fetch).toHaveBeenCalledTimes(190);
});

test('adapter uses choice questions, the endpoint, model, auth and five-second no-redirect timeout', async () => {
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
  expect(PROTOCOL.version).toBe(2);
  expect(Object.values(request.questions).every(question => question.type === 'choice')).toBe(true);
  expect(request.questions.calories.criteria).toMatchObject({ kcal_0_25: '[0,25)', kcal_2475_2500: '[2475,2500)', kcal_2500_plus: '2500+' });
  for (const macro of ['protein', 'carbs', 'fat'] as const) {
    expect(request.questions[macro].criteria).toMatchObject({ g_0_2: '[0,2)', g_198_200: '[198,200)', g_200_plus: '200+' });
  }
  for (const row of fixture.truth.rows) expect(Buffer.byteLength(JSON.stringify(buildMacroRequest(row)))).toBeLessThanOrEqual(12000);
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

test('probability-weighted estimates retain argmax bins separately, including open-top gram bins', () => {
  const body = responseFor(fixture.truth.rows[0]!);
  for (const answer of Object.values(body.answers)) {
    for (const name of Object.keys(answer.probabilities)) answer.probabilities[name] = 0;
  }
  Object.assign(body.answers.calories, { choice: 'kcal_25_50', confidence: 0.75 });
  Object.assign(body.answers.calories.probabilities, { kcal_0_25: 0.25, kcal_25_50: 0.75 });
  Object.assign(body.answers.protein, { choice: 'g_0_2', confidence: 0.6 });
  Object.assign(body.answers.protein.probabilities, { g_0_2: 0.6, g_2_4: 0.4 });
  Object.assign(body.answers.carbs, { choice: 'g_200_plus', confidence: 0.75 });
  Object.assign(body.answers.carbs.probabilities, { g_198_200: 0.25, g_200_plus: 0.75 });
  Object.assign(body.answers.fat, { choice: 'g_198_200', confidence: 0.6 });
  Object.assign(body.answers.fat.probabilities, { g_198_200: 0.6, g_200_plus: 0.4 });
  const events = journal(1); events[2]!['body'] = JSON.stringify(body);
  const result = replayJournal(fixture, events).results[0]!;
  expect(result.failure).toBeNull();
  expect(result.estimate!.calories).toBeCloseTo(31.25);
  expect(result.estimate!.protein).toBeCloseTo(1.8);
  expect(result.estimate!.carbs).toBeCloseTo(201.25);
  expect(result.estimate!.fat).toBeCloseTo(200.2);
  expect(result.argmaxBins).toEqual({ calories: 'kcal_25_50', protein: 'g_0_2', carbs: 'g_200_plus', fat: 'g_198_200' });
});

test.each([
  { calories: 0, grams: 0, expectedCalories: 12.5, expectedGrams: 1 },
  { calories: 2475, grams: 198, expectedCalories: 2487.5, expectedGrams: 199 },
  { calories: 2500, grams: 200, expectedCalories: 2525, expectedGrams: 202 },
])('one-hot ranges use bounded midpoints and lower-edge-plus-width overflow representatives: $calories/$grams', sample => {
  const body = responseFor({ ...fixture.truth.rows[0]!, calories: sample.calories,
    protein_g: sample.grams, carbs_g: sample.grams, fat_g: sample.grams });
  const events = journal(1); events[2]!['body'] = JSON.stringify(body);
  expect(replayJournal(fixture, events).results[0]!.estimate).toEqual({ calories: sample.expectedCalories,
    protein: sample.expectedGrams, carbs: sample.expectedGrams, fat: sample.expectedGrams });
});

test('rounded probability mass is normalized and the provider choice breaks argmax ties', () => {
  const body = responseFor(fixture.truth.rows[0]!);
  const answer = body.answers.calories;
  for (const name of Object.keys(answer.probabilities)) answer.probabilities[name] = 0;
  Object.assign(answer, { choice: 'kcal_25_50', confidence: 0.4975 });
  Object.assign(answer.probabilities, { kcal_0_25: 0.4975, kcal_25_50: 0.4975 });
  const events = journal(1); events[2]!['body'] = JSON.stringify(body);
  const result = replayJournal(fixture, events).results[0]!;
  expect(result.estimate!.calories).toBeCloseTo(25);
  expect(result.argmaxBins!.calories).toBe('kcal_25_50');
});

test.each([
  ['missing probability', (answer: Record<string, unknown>) => { delete (answer['probabilities'] as Record<string, number>)['g_0_2']; }],
  ['extra probability', (answer: Record<string, unknown>) => { (answer['probabilities'] as Record<string, number>)['g_202_204'] = 0; }],
  ['negative probability', (answer: Record<string, unknown>) => { (answer['probabilities'] as Record<string, number>)['g_0_2'] = -0.1; }],
  ['non-finite probability', (answer: Record<string, unknown>) => { (answer['probabilities'] as Record<string, number>)['g_0_2'] = NaN; }],
  ['over-one probability', (answer: Record<string, unknown>) => { (answer['probabilities'] as Record<string, number>)[answer['choice'] as string] = 1.1; }],
  ['invalid total', (answer: Record<string, unknown>) => { (answer['probabilities'] as Record<string, number>)[answer['choice'] as string] = 0.5; }],
  ['zero total', (answer: Record<string, unknown>) => { (answer['probabilities'] as Record<string, number>)[answer['choice'] as string] = 0; }],
  ['unknown choice', (answer: Record<string, unknown>) => { answer['choice'] = 'g_202_204'; }],
  ['non-argmax choice', (answer: Record<string, unknown>) => { answer['choice'] = answer['choice'] === 'g_0_2' ? 'g_2_4' : 'g_0_2'; }],
  ['missing confidence', (answer: Record<string, unknown>) => { delete answer['confidence']; }],
  ['invalid confidence', (answer: Record<string, unknown>) => { answer['confidence'] = 1.1; }],
  ['numeric answer', (answer: Record<string, unknown>) => { answer['type'] = 'number'; answer['value'] = 10; }],
] as const)('invalid choice answer (%s) is a billed miss with no estimate or argmax', (_name, invalidate) => {
  const body = responseFor(fixture.truth.rows[0]!);
  invalidate(body.answers.fat);
  const events = journal(1); events[2]!['body'] = JSON.stringify(body);
  const result = replayJournal(fixture, events).results[0]!;
  expect(result).toMatchObject({ estimate: null, argmaxBins: null, failure: 'Invalid typed macro response' });
  expect(result.costUsd).toBeCloseTo(700 * 0.042 / 1_000_000);
});

test('the original HTTP 400 journal stays intact as protocol-v1 evidence and cannot be replayed as v2', () => {
  const contents = readFileSync(join(__dirname, 'results/2026-10-26-attempt1-400.jsonl'), 'utf8');
  expect(sha256(contents)).toBe('00d3c505091ea40c8e151099f9d467276407d45b20e010fd91293245efa9058d');
  const events = parseJournal(contents);
  expect(events[0]!['protocol']).toMatchObject({ version: 1 });
  expect(events[2]).toMatchObject({ event: 'response', status: 400 });
  expect(events[3]).toEqual({ event: 'end', stopReason: 'Unknown usage; stopped without retry' });
  expect(() => replayJournal(fixture, events)).toThrow('identity mismatch');
  expect(fetch).not.toHaveBeenCalled();
});

test('full replay retains estimates, cost and original journal without credentials or fetch', async () => {
  delete process.env['TYPESAFE_API_KEY'];
  const input = join(root, 'input.jsonl'), out = join(root, 'replayed');
  const contents = journal().map(event => JSON.stringify(event, null, 0)).join('\n') + '\n';
  writeFileSync(input, contents);
  const report = await runEvaluation([`--journal=${input}`, `--out=${out}`, '--mode=replay']);
  expect(fetch).not.toHaveBeenCalled();
  expect(report.stopReason).toBeNull();
  expect(report.metrics).toMatchObject({ total: 190, successful: 190, failures: 0 });
  expect(report.metrics.medianAbsolutePctError.calories).toBeGreaterThan(0);
  expect(report.results.every(result => result.argmaxBins && result.estimate)).toBe(true);
  expect(report.metrics.costUsdPer1000Items).toBeCloseTo(0.0294);
  expect(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).toBe(contents);
  const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  expect(summary.truthSha256).toBe(fixture.digest);
  expect(summary.version).toBe(2);
  expect(summary.results[0].argmaxBins).toEqual(report.results[0]!.argmaxBins);
  const markdown = readFileSync(join(out, 'report.md'), 'utf8');
  expect(markdown).toContain('12.98 | 15.48 | 14.84 | 21.92 | 8/60');
  expect(markdown).toContain('different prompts and inputs');
  expect(markdown).toContain('+/-12.5 kcal');
  expect(markdown).toContain('+/-1 g');
  expect(markdown).toContain('no finite quantization-error bound');
  expect(markdown).toContain('argmaxBins');
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
    if (index === 1) body.answers.fat.probabilities['g_0_2'] = -1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const report = await runEvaluation(['--mode=live', `--out=${join(root, 'invalid-shape')}`]);
  expect(fetch).toHaveBeenCalledTimes(190);
  expect(report.metrics).toMatchObject({ attempted: 190, failures: 1, unknownUsageCount: 0 });
  expect(report.metrics.perItem[0]).toMatchObject({ catastrophic: true, failure: 'Invalid typed macro response' });
  expect(report.results[0]!.costUsd).toBeCloseTo(700 * 0.042 / 1_000_000);
});

test.each([400, 429, 500])('HTTP %i with no usage retains the raw error and stops', async status => {
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
