import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { experimentIdentity, parseJournal, type JevRequest, type JournalEvent } from '../lib/jev-experiment';
import { scoreSlices } from './exploratory-score';
import { coarseQuestion, coarseRequest, decodeHierarchical, fineRequest, selectHierarchicalRows } from './hierarchical-bins';
import { hierarchicalExperiment, replayHierarchical, runHierarchicalEvaluation, savedV2 } from './hierarchical';
import { buildMacroRequest, protocolSha256, runEvaluation } from './run';
import { macroNames, type Macros } from './score';
import { loadTruth, repository } from './truth';

const fixture = loadTruth(), rows = selectHierarchicalRows(fixture), experiment = hierarchicalExperiment(fixture);
const mixed = { calories: 'b2', protein: 'zero', carbs: 'b1', fat: 'b0' };
function response(request: JevRequest, choices: Record<string, string>, blended = false) {
  return { model: 'jev-1.14.0', usage: { input_tokens: 700, output_tokens: 10 },
    answers: Object.fromEntries(Object.entries(request.questions).map(([macro, question]) => [macro, {
      type: 'choice', confidence: 0, choice: choices[macro],
      probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key,
        blended ? key === 'r9' ? .6 : key === 'r0' ? .4 : 0 : key === choices[macro] ? 1 : 0])),
    }])) };
}
function singleJournal(choices = mixed, withFine = true): JournalEvent[] {
  const row = rows[0]!, coarse = coarseRequest(row), fine = fineRequest(row, choices);
  return [{ event: 'start', ...experimentIdentity(experiment) },
    { event: 'request', id: row.id, stage: 1, request: coarse },
    { event: 'response', id: row.id, stage: 1, status: 200, latencyMs: 100, body: JSON.stringify(response(coarse, choices)) },
    ...(withFine && Object.keys(fine.questions).length ? [
      { event: 'request', id: row.id, stage: 2, request: fine },
      { event: 'response', id: row.id, stage: 2, status: 200, latencyMs: 200,
        body: JSON.stringify(response(fine, Object.fromEntries(Object.keys(fine.questions).map(macro => [macro, 'r9'])), true)) },
    ] : []), { event: 'end', stopReason: null }];
}
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jev-v3-'));
  process.env['TYPESAFE_API_KEY'] = 'synthetic-v3-key';
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
});
afterEach(() => { delete process.env['TYPESAFE_API_KEY']; jest.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

test('freezes the exact 168 original states and excludes only the 22 flagged drink identities', () => {
  expect(rows).toHaveLength(168);
  expect(rows.filter(row => row.chain === 'WaBa Grill')).toHaveLength(88);
  expect(rows.filter(row => row.chain === 'Yoshinoya')).toHaveLength(80);
  expect(fixture.truth.rows.filter(row => !rows.includes(row))).toHaveLength(22);
  for (const row of rows) expect(coarseRequest(row).state).toEqual(buildMacroRequest(row).state);
  expect(() => selectHierarchicalRows({ ...fixture, truth: { ...fixture.truth, rows: [...fixture.truth.rows].reverse() } })).toThrow('original order');
  expect(() => selectHierarchicalRows({ ...fixture, digest: 'bad' })).toThrow('frozen 168');
  expect(protocolSha256).toBe('77e9a692ce7ca5c93dca5b167f6cd9cafd838d87d41a048a12ecaa2b86e11c76');
});

test('TypeScript payloads exactly match the recommended Python builders, including every fine interval', () => {
  const python = [
    'import json, sys',
    'sys.path.insert(0, "scripts/eval/audit")',
    'import rerun_design as d',
    'rows=json.load(open("scripts/eval/jev-macro/truth.json"))["rows"]',
    'rows=[r for r in rows if not (r["id"].startswith("yoshinoya:drinks/") and not r["id"].startswith("yoshinoya:drinks/14-oz-"))]',
    'state=d.state_for(rows[0])',
    'print(json.dumps({"coarse":[d.coarse_request(d.state_for(r)) for r in rows], "fine":[d.fine_request(state,{m:"b"+str(i) for m in d.MACROS}) for i in range(12)], "mixed":d.fine_request(state,{"calories":"b2","protein":"zero","carbs":"b1","fat":"overflow"})}))',
  ].join('\n');
  const expected = JSON.parse(execFileSync('python3', ['-B', '-c', python], { cwd: repository, encoding: 'utf8', maxBuffer: 2_000_000 }));
  expect(rows.map(coarseRequest)).toEqual(expected.coarse);
  expect(Array.from({ length: 12 }, (_, i) => fineRequest(rows[0]!, Object.fromEntries(macroNames.map(m => [m, `b${i}`])) as Record<keyof Macros, string>))).toEqual(expected.fine);
  expect(fineRequest(rows[0]!, { ...mixed, fat: 'overflow' })).toEqual(expected.mixed);
  expect(coarseQuestion('calories').criteria).toMatchObject({ zero: 'total = 0', b0: '0 < total < 250', b1: '250 <= total < 500', b11: '2750 <= total < 3000', overflow: 'total >= 3000' });
  expect(coarseQuestion('fat').criteria).toMatchObject({ b0: '0 < total < 20', b11: '220 <= total < 240', overflow: 'total >= 240' });
  for (const request of expected.coarse) expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(12000);
});

test('primary argmax, exact zero, conditional fine EV and provider tie-breaking are predeclared', () => {
  const row = rows[0]!, coarse = coarseRequest(row), fine = fineRequest(row, mixed);
  const coarseRaw = response(coarse, mixed), fineRaw = response(fine, { calories: 'r9', carbs: 'r9', fat: 'r9' }, true);
  const decoded = decodeHierarchical(row, coarseRaw, fineRaw);
  expect(decoded.estimate).toEqual({ calories: 737.5, protein: 0, carbs: 39, fat: 19 });
  expect(decoded.conditionalEv).toMatchObject({ calories: 647.5, protein: 0 });
  expect(decoded.conditionalEv!.carbs).toBeCloseTo(31.8);
  expect(decoded.conditionalEv!.fat).toBeCloseTo(11.8);
  coarseRaw.answers['calories']!.probabilities['b2'] = .5; coarseRaw.answers['calories']!.probabilities['zero'] = .5;
  fineRaw.answers['calories']!.probabilities['r0'] = .5; fineRaw.answers['calories']!.probabilities['r9'] = .5;
  expect(decodeHierarchical(row, coarseRaw, fineRaw)).toMatchObject({ estimate: { calories: 737.5 }, conditionalEv: { calories: 625 } });
  fineRaw.answers['calories']!.choice = 'r0'; fineRaw.answers['calories']!.probabilities['r9'] = .6; fineRaw.answers['calories']!.probabilities['r0'] = .4;
  expect(() => decodeHierarchical(row, coarseRaw, fineRaw)).toThrow('Invalid choice');
});

test('overflow is an item failure without clipping, while zero eliminates the fine request', () => {
  const zero = { calories: 'zero', protein: 'zero', carbs: 'zero', fat: 'zero' };
  const zeros = replayHierarchical(fixture, singleJournal(zero));
  expect(zeros.exchanges).toHaveLength(1);
  expect(zeros.results[0]).toMatchObject({ estimate: { calories: 0, protein: 0, carbs: 0, fat: 0 }, requests: 1, failure: null });
  const overflow = replayHierarchical(fixture, singleJournal({ ...mixed, fat: 'overflow' }));
  expect(overflow.exchanges).toHaveLength(2);
  expect(overflow.results[0]).toMatchObject({ estimate: null, conditionalEv: null, failure: 'Overflow: fat', partialArgmax: { calories: 737.5, protein: 0 } });
  const m = scoreSlices(rows, overflow.results).all;
  expect(m).toMatchObject({ total: 168, failures: 168, catastrophicMisses: 168, medianAbsolutePctError: { calories: null, protein: null, carbs: null, fat: null } });
  expect(replayHierarchical(fixture, singleJournal({ calories: 'overflow', protein: 'overflow', carbs: 'overflow', fat: 'overflow' })).exchanges).toHaveLength(1);
});

test('saved same-168 v2 scores reproduce the audit for both decoders', () => {
  const saved = savedV2(fixture, rows), ev = scoreSlices(rows, saved.expectedValue), argmax = scoreSlices(rows, saved.argmax);
  expect(ev.all.medianAbsolutePctError.calories).toBeCloseTo(25.86, 2);
  expect(ev.all.medianAbsolutePctError.protein).toBeCloseTo(39.45, 2);
  expect(ev.all.medianAbsolutePctError.carbs).toBeCloseTo(39.18, 2);
  expect(ev.all.medianAbsolutePctError.fat).toBe(100);
  expect(ev.all.catastrophicMisses).toBe(47);
  expect(argmax.all.catastrophicMisses).toBe(35);
  expect(argmax.all.medianAbsolutePctError.calories).toBeCloseTo(22.35, 2);
  expect(argmax.all.medianAbsolutePctError.fat).toBeCloseTo(53.94, 2);
  expect(ev.all.knownCostUsd).toBeCloseTo(1_928_880 * .042 / 1e6);
  expect(Object.values(ev.categories).reduce((sum, group) => sum + group.total, 0)).toBe(168);
  expect(ev.fatAtLeast2g.total).toBe(rows.filter(row => row.fat_g >= 2).length);
  expect(fetch).not.toHaveBeenCalled();
});

test('full simulated collection and the real npm replay command agree on both decoders and all paired slices', async () => {
  const out = join(root, 'simulated'); let coarseCount = 0;
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    const request: JevRequest = JSON.parse(String(init!.body));
    const last = parseJournal(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8')).at(-1)!;
    expect(last).toMatchObject({ event: 'request', request });
    if (last['stage'] === 1) {
      coarseCount++;
      return new Response(JSON.stringify(response(request, coarseCount === 1
        ? { calories: 'zero', protein: 'zero', carbs: 'zero', fat: 'zero' } : mixed)));
    }
    expect(Object.keys(request.questions)).toEqual(['calories', 'carbs', 'fat']);
    expect(Object.keys(request.questions['calories']!.criteria)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9']);
    return new Response(JSON.stringify(response(request, { calories: 'r9', carbs: 'r9', fat: 'r9' }, true)));
  });
  const live = await runEvaluation(['--mode=live', '--protocol=v3', `--out=${out}`]);
  expect(fetch).toHaveBeenCalledTimes(335);
  expect(live).toMatchObject({ version: 3, exploratory: true, stopReason: null, metrics: { total: 168, successful: 168, failures: 0 } });
  const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  expect(summary.accounting.requests).toBe(335);
  expect(summary.metrics.costUsdPer1000Items).toBeCloseTo(335 * 700 * .042 / 1e6 / 168 * 1000);
  expect(summary.results[1].requests).toBe(2);
  expect(summary.results[1].estimate.calories).toBe(737.5);
  expect(summary.results[1].conditionalEv.calories).toBe(647.5);
  expect(summary.comparisons['saved v2 EV'].all.total).toBe(168);
  const markdown = readFileSync(join(out, 'report.md'), 'utf8');
  for (const text of ['EXPLORATORY', 'fat >=2 g', 'Category: sauces', 'Cal MAE', 'Zero-truth rows', 'conditional', 'p95 ms', 'saved v2 argmax']) expect(markdown).toContain(text);
  const guard = join(root, 'offline.cjs'), replayOut = join(root, 'replay');
  writeFileSync(guard, "globalThis.fetch = () => { throw new Error('Network forbidden'); };\n");
  const stdout = execFileSync('npm', ['run', 'eval:jev-macro', '-w', 'scripts', '--', '--mode=replay', '--protocol=v3',
    `--journal=${join(out, 'jev-raw.jsonl')}`, `--out=${replayOut}`],
  { cwd: repository, encoding: 'utf8', env: { PATH: process.env['PATH'], NODE_OPTIONS: `--require=${guard}` } });
  expect(stdout).toContain('"successful":168');
  expect(JSON.parse(readFileSync(join(replayOut, 'summary.json'), 'utf8')).comparisons).toEqual(summary.comparisons);
  expect(readFileSync(join(replayOut, 'jev-raw.jsonl'), 'utf8')).toBe(readFileSync(join(out, 'jev-raw.jsonl'), 'utf8'));
});

test('replay requires the conditional fine request, exact intervals, two-request ceiling and separate protocol identity', () => {
  const events = singleJournal();
  expect(() => replayHierarchical(fixture, [events[0]!, ...events.slice(3)])).toThrow('request mismatch');
  const wrong = singleJournal(); wrong[3]!['request'] = fineRequest(rows[0]!, { ...mixed, calories: 'b3' });
  expect(() => replayHierarchical(fixture, wrong)).toThrow('request mismatch');
  expect(() => replayHierarchical(fixture, [...events.slice(0, -1), events[3]!, events[4]!, events.at(-1)!])).toThrow('request mismatch');
  const incomplete = replayHierarchical(fixture, singleJournal(mixed, false));
  expect(incomplete.results[0]).toMatchObject({ estimate: null, failure: expect.stringContaining('Incomplete fine'), costUsd: 700 * .042 / 1e6 });
  expect(incomplete.stopReason).toBe('Incomplete evaluation');
  expect(() => replayHierarchical(fixture, [{ ...events[0]!, protocolSha256 }, ...events.slice(1)])).toThrow('identity');
});

test('fine-stage timeout preserves known coarse spend, unknown fine usage and the full denominator', async () => {
  const events = singleJournal().slice(0, 4);
  events.push({ event: 'error', id: rows[0]!.id, stage: 2, latencyMs: 5000 }, { event: 'end', stopReason: null });
  const input = join(root, 'timeout.jsonl'), out = join(root, 'timeout-report');
  writeFileSync(input, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  delete process.env['TYPESAFE_API_KEY'];
  const report = await runHierarchicalEvaluation(['--mode=replay', `--journal=${input}`, `--out=${out}`]);
  expect(report.metrics).toMatchObject({ total: 168, failures: 168, catastrophicMisses: 168, totalCostUsd: null,
    knownCostUsd: 700 * .042 / 1e6, unknownUsageCount: 1 });
  expect(report.results[0]).toMatchObject({ latencyMs: 5100, requests: 2, costUsd: null });
  expect(report.accounting.unknownUsageRequests).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
});

test('fine-stage model drift invalidates the whole item and prohibits another item request', () => {
  const events = singleJournal(), changed = JSON.parse(String(events[4]!['body']));
  changed.model = 'jev-1.15.0'; events[4]!['body'] = JSON.stringify(changed);
  const replay = replayHierarchical(fixture, events);
  expect(replay.stopReason).toBe('Model drift from jev-1.14.0');
  expect(replay.results[0]).toMatchObject({ estimate: null, conditionalEv: null, requests: 2, failure: 'Model drift from jev-1.14.0' });
  expect(() => replayHierarchical(fixture, [...events.slice(0, -1),
    { event: 'request', id: rows[1]!.id, stage: 1, request: coarseRequest(rows[1]!) }])).toThrow('request mismatch');
});

test('v3 rejects invalid flags, credential paths, missing keys and existing output before transport', async () => {
  for (const args of [['--protocol=v4'], ['--protocol=v3', '--protocol=v2'], ['--protocol=v3', '--mode=replay', '--journal=.env']]) {
    await expect(runEvaluation([...args, `--out=${join(root, 'invalid')}`])).rejects.toThrow();
  }
  await expect(runEvaluation(['--protocol=v3', '--mode=live', `--out=${root}`])).rejects.toThrow('EEXIST');
  delete process.env['TYPESAFE_API_KEY'];
  await expect(runEvaluation(['--protocol=v3', '--mode=live', `--out=${join(root, 'missing')}`])).rejects.toThrow('TYPESAFE_API_KEY');
  expect(fetch).not.toHaveBeenCalled();
});
