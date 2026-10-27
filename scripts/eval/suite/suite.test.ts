import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fs from 'node:fs';
import { buildSuite, servingGroups, writeSuite } from './build';
import { durableAppend, loadCases, sha256, stratifiedSample, verifyChecksums } from './fixtures';
import { exactMatcher, estimatorState, jevMethod, matchingRequest, method } from './adapters';
import { JevClient, RESERVATION_USD, STOP_USD, spendState } from './budget';
import { score, percentError } from './metrics';
import { affordableSelection, evaluateCase, options, requestedSelection, run } from './run';
import { candidate, rowSchema, type MacroCase, type MatchCase, type Result, type Row } from './types';
import { type JevRequest } from '../lib/jev-experiment';

const dirs: string[] = [];
const temporary = () => { const p = mkdtempSync(join(tmpdir(), 'fitsy-suite-test-')); dirs.push(p); return p; };
afterEach(() => { dirs.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); jest.restoreAllMocks(); });
const row: Row = { id: 'toy:beans', chain: 'Toy Chain', name: 'Beans', section: 'Sides', serving: '1 portion', region: '',
  macros: { calories: 100, protein: 5, carbs: 15, fat: 2 }, source: { url: 'https://example.org/official.pdf', page: 1, sha256: 'a'.repeat(64), locator: 'page 1, Beans' } };
const input = { chain: row.chain, name: row.name, section: row.section, serving: row.serving, region: '', description: '' };
const matchCase: MatchCase = { id: 'toy-match', tier: 'curated', split: 'dev', group: row.id, category: 'portion', chain: row.chain,
  source: row.source, origin: 'published-row', why: 'Toy portion check.', input, task: 'matching', candidates: [row.id], expected: { kind: 'match', matchId: row.id } };
const macroCase: MacroCase = { ...matchCase, id: 'toy-macro', task: 'macro', expected: row.macros };
const result = (id: string, output: Result['output'], extra: Partial<Result> = {}): Result => ({ id, output, method: 'test', failure: null, latencyMs: 10, requests: 1, costUsd: 0.01, ...extra });
function response(request: JevRequest, selections: Record<string, string> = {}, extra = {}) {
  return { model: 'jev-1.14.0', usage: { input_tokens: 100, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(request.questions).map(([name, q]) => {
    const choice = selections[name] ?? Object.keys(q.criteria)[0]!;
    return [name, { type: 'choice', choice, confidence: 0.9, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === choice ? 1 : 0])) }];
  })), ...extra };
}
const request = matchingRequest(input, [candidate(row)]);
function mockTransport(answer: (r: JevRequest) => unknown = r => response(r)) {
  return jest.fn(async (_url, init) => new Response(JSON.stringify(answer(JSON.parse(String(init?.body)))))) as jest.MockedFunction<typeof fetch>;
}
function client(fetcher = mockTransport()) {
  const directory = temporary(), out = join(directory, 'run'); mkdirSync(out);
  return { directory, out, fetcher, client: new JevClient('toy-run', directory, out, 'test-only-fake-key', fetcher) };
}

test('frozen suite reproduces exactly with official references and 30-40% holdout per tier/task', () => {
  expect(() => writeSuite('--check')).not.toThrow();
  expect(() => writeSuite('--initialize')).toThrow('already frozen');
  const built = buildSuite();
  const dev = new Set(built.cases.filter(c => c.split === 'dev').map(c => c.group));
  expect(built.cases.filter(c => c.split === 'holdout').every(c => !dev.has(c.group))).toBe(true);
  for (const tier of ['curated', 'bulk']) for (const task of ['matching', 'macro']) {
    const cases = built.cases.filter(c => c.tier === tier && c.task === task);
    const holdout = cases.filter(c => c.split === 'holdout').length / cases.length;
    expect(holdout).toBeGreaterThanOrEqual(0.30); expect(holdout).toBeLessThanOrEqual(0.40);
    if (tier === 'curated') expect(cases.filter(c => !c.id.includes(':measured:'))).toHaveLength(160);
  }
  const rows = JSON.parse(built.outputs.get('data/rows.json')!) as Row[];
  expect(built.cases.filter(c => c.tier === 'bulk' && c.task === 'macro')).toHaveLength(rows.length);
  expect(rows).toHaveLength(338);
  expect(built.cases.some(c => c.split === 'dev' && (c.chain === 'Claim Jumper'
    || c.task === 'matching' && c.candidates.some(id => id.startsWith('claim-jumper:'))))).toBe(false);
  expect(built.cases.some(c => c.group.startsWith('yoshinoya:drinks/'))).toBe(false);
  expect(built.cases.filter(c => c.tier === 'bulk' && c.origin === 'captured-uber-eats').length).toBeGreaterThan(2000);
  expect(built.cases.filter(c => c.tier === 'curated' && c.origin === 'captured-uber-eats').length).toBeGreaterThan(10);
  expect(built.cases.some(c => c.id.startsWith('bulk:same-name:'))).toBe(true);
  const tags = new Set(built.cases.filter(c => c.tier === 'curated').map(c => c.category));
  for (const tag of ['non_chain_lookalike', 'modifier', 'drink_oz', 'zero_macro', 'regional_variant', 'catering_family', 'combo_build_your_own']) expect(tags.has(tag)).toBe(true);
});

test('tampered holdout/reference checksum fails without scoring any held-out cases', () => {
  const dir = temporary(), built = buildSuite(); mkdirSync(join(dir, 'data'));
  for (const [file, bytes] of built.outputs) {
    mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), bytes);
  }
  expect(verifyChecksums(dir)).toEqual(verifyChecksums());
  writeFileSync(join(dir, 'data/curated.holdout.jsonl'), '{}\n');
  expect(() => loadCases('dev', 'both', dir)).toThrow('checksum mismatch');
});

test('equivalent named component servings share a split across combo headings and side contexts', () => {
  const built = buildSuite(), rows = JSON.parse(built.outputs.get('data/rows.json')!) as Row[], groups = servingGroups(rows);
  const splitByRow = new Map(built.cases.filter(c => c.tier === 'bulk' && c.task === 'macro')
    .map(c => [c.id.replace(/^bulk:(?:measured:)?macro:/, ''), c.split]));
  const identity = new Map<string, string>();
  for (const row of rows) {
    const group = groups.get(row.id)!;
    expect(splitByRow.get(row.id)).toBe(splitByRow.get(group));
    const mass = /^(\d+(?:\.\d+)?) g\b/.exec(row.serving)?.[1];
    if (!mass) continue;
    const key = JSON.stringify([row.chain, row.name, mass, row.macros]);
    expect(identity.get(key) ?? group).toBe(group); identity.set(key, group);
  }
  const modifiedComponent = built.cases.find(c => c.id === 'curated:match:094')!;
  expect(modifiedComponent.input.name).toContain('add avocado');
  expect(modifiedComponent.input.name).not.toContain('no rice');
});

test('measured cases preserve all reviewed collisions and candidate portions without uncertain bindings', () => {
  const built = buildSuite();
  const measured = built.cases.filter((c): c is MatchCase => c.tier === 'bulk' && c.task === 'matching' && !!c.capture);
  expect(measured).toHaveLength(176);
  expect(built.manifest.extension.excluded).toBe(83);
  const osf = measured.filter(c => c.chain === 'The Old Spaghetti Factory');
  const regular = osf.find(c => c.input.name === 'Marinara Sauce' && c.input.section === 'Pasta Classics')!;
  const gluten = osf.find(c => c.input.name === 'Marinara Sauce' && c.input.section === 'Gluten Sensitive')!;
  const catering = osf.find(c => c.input.name === 'Marinara Sauce' && c.input.section === 'Catering')!;
  expect(regular.candidates).toHaveLength(4);
  expect(regular.expected.matchId).toBe('the-old-spaghetti-factory:pasta-classic-entrees/marinara-sauce');
  expect(gluten.expected.matchId).toBe('the-old-spaghetti-factory:gluten-sensitive/marinara-sauce');
  expect(catering.expected.kind).toBe('none');
  expect(gluten.group).toBe(regular.group); expect(catering.group).toBe(regular.group);
  expect(gluten.split).toBe(regular.split); expect(catering.split).toBe(regular.split);
  expect(osf.some(c => c.input.section === 'Catering' && c.input.name === 'Sicilian Garlic Cheese Bread')).toBe(false);
  expect(measured.some(c => c.chain === 'Claim Jumper' && c.input.name === 'Baked Potato')).toBe(false);
  const rowSplits = new Map(built.cases.filter(c => c.task === 'macro' && c.tier === 'bulk')
    .map(c => [c.id.replace(/^bulk:(?:measured:)?macro:/, ''), c.split]));
  for (const c of measured) {
    expect(c.candidates.every(id => rowSplits.get(id) === c.split)).toBe(true);
    expect(c.input.description).not.toMatch(/\b\d+\s*(?:cal\.|calories|kcal)/i);
  }
});

test('optional source tags reach matcher adapters without exposing labels or mutating references', () => {
  const tagged = rowSchema.parse({ ...row, tags: ['component', 'gluten-sensitive'] });
  const projected = candidate(tagged);
  expect(projected.tags).toEqual(['component', 'gluten-sensitive']);
  expect(matchingRequest(input, [projected]).state).toMatchObject({ candidates: { c0: { tags: tagged.tags } } });
  projected.tags!.push('dish');
  expect(tagged.tags).toEqual(['component', 'gluten-sensitive']);
  expect(candidate(row)).not.toHaveProperty('tags');
  expect(() => rowSchema.parse({ ...row, tags: ['expected-positive'] })).toThrow();
  const state = JSON.stringify(matchingRequest(input, [candidate(tagged)]).state);
  for (const hidden of [row.id, 'macros', 'expected', 'source', 'category', 'holdout']) expect(state).not.toContain(hidden);
});

test('exact matcher keeps brand, portion, modifier and regional distinctions; ambiguity abstains', async () => {
  expect(await exactMatcher.match(input, [candidate(row)])).toEqual({ kind: 'match', matchId: row.id, confidence: 1 });
  for (const changed of [{ chain: 'Independent Toy' }, { name: 'Beans, add avocado' }, { serving: '2 portions' }, { region: 'Fresno' }]) {
    expect((await exactMatcher.match({ ...input, ...changed }, [candidate(row)])).kind).toBe('none');
  }
  expect((await exactMatcher.match(input, [candidate(row), { ...candidate(row), id: 'other' }])).kind).toBe('abstain');
});

test('Jev projections expose no expected macros, fixture IDs, labels, rationale or holdout fields', () => {
  const state = matchingRequest(input, [candidate(row)]).state;
  const all = JSON.stringify({ state, estimator: estimatorState(input) });
  for (const text of [row.id, 'expected', 'calories', 'protein', 'category', 'holdout', 'source', 'why']) expect(all.includes(text)).toBe(false);
  expect(() => estimatorState({ ...input, description: 'Provides 100 calories.' })).toThrow('Nutrition target');
  expect(() => method('haiku')).toThrow('client missing'); expect(() => method('qwen')).toThrow('client missing');
  expect(() => options(['--methods=jev-v3'])).toThrow('explicit');
  expect(options(['--methods=haiku', '--live']).jevReplayOnly).toBe(true);
  expect(() => options(['--methods=qwen', '--split=holdout', '--live'])).toThrow('dev-only');
  expect(() => options(['--split=dev', '--split=holdout'])).toThrow('Usage');
});

test('v3 matcher decodes a candidate and v3 estimator preserves zero and conditional fine midpoint', async () => {
  const { client: c, fetcher } = client(mockTransport(r => response(r, Object.fromEntries(Object.keys(r.questions).map(k =>
    [k, k === 'match' ? 'c0' : k === 'calories' ? Object.hasOwn(r.questions[k]!.criteria, 'r0') ? 'r3' : 'b1' : 'zero'])))));
  try {
    const adapter = jevMethod(c);
    expect((await adapter.matcher!.match(input, [candidate(row)])).matchId).toBe(row.id);
    expect(await adapter.estimator!.estimate(input)).toEqual({ calories: 337.5, protein: 0, carbs: 0, fat: 0 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(spendState(c.ledger).knownUsd).toBeCloseTo(3 * 100 * .042 / 1e6);
  } finally { c.close(); }
});

test('v3 estimator records overflow as an unsuccessful item without clipping or refinement', async () => {
  const { client: c, fetcher } = client(mockTransport(r => response(r, { calories: 'overflow' })));
  try { expect(await jevMethod(c).estimator!.estimate(input)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1); }
  finally { c.close(); }
});

test.each(['unknown', 'http', 'drift', 'distribution', 'echo', 'transport'])('Jev %s failure stops immediately and keeps billing/secret-safe receipts', async kind => {
  const fetcher = mockTransport(r => response(r));
  if (kind === 'transport') fetcher.mockRejectedValueOnce(new Error('test-only-fake-key'));
  else fetcher.mockImplementationOnce(async (_url, init) => {
    const data = response(JSON.parse(String(init?.body))) as Record<string, unknown>;
    if (kind === 'unknown') delete data['usage'];
    if (kind === 'drift') data['model'] = 'jev-other';
    if (kind === 'distribution') data['answers'] = {};
    if (kind === 'echo') data['echo'] = 'test-only-fake-key';
    return new Response(JSON.stringify(data), { status: kind === 'http' ? 429 : 200 });
  });
  const { client: c } = client(fetcher);
  try {
    await expect(c.send(request)).rejects.toThrow();
    await expect(c.send(request)).rejects.toThrow('stopped');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readFileSync(c.rawFile, 'utf8')).not.toContain('test-only-fake-key');
    expect(spendState(c.ledger).unknown).toBe(['unknown', 'transport'].includes(kind));
    expect(c.knownUsd).toBe(kind === 'unknown' || kind === 'transport' ? 0 : 100 * .042 / 1e6);
  } finally { c.close(); }
});

test('exclusive ledger, cross-run cumulative cap and interrupted reservations refuse additional calls', async () => {
  const { client: c, directory, out } = client();
  expect(() => new JevClient('other', directory, out, 'fake-key')).toThrow();
  c.close();
  durableAppend(join(directory, 'spend.jsonl'), { event: 'reserve', requestId: 'past', runId: 'past', at: 'today', reserveUsd: RESERVATION_USD });
  expect(() => new JevClient('other', directory, out, 'fake-key')).toThrow('Unknown');
  durableAppend(join(directory, 'spend.jsonl'), { event: 'settle', requestId: 'past', runId: 'past', at: 'today', costUsd: STOP_USD - RESERVATION_USD / 2 });
  expect(() => new JevClient('other', directory, out, 'fake-key')).toThrow('threshold');
  expect(existsSync(join(directory, '.jev.lock'))).toBe(false);
});

test('identical paid requests replay across invocations, while changed candidate tags require a new answer', async () => {
  const first = client();
  await first.client.send(request);
  await first.client.send(request);
  expect(first.fetcher).toHaveBeenCalledTimes(1);
  expect(first.client.reusedRequests).toBe(1);
  first.client.close();
  const out = join(first.directory, 'second'); mkdirSync(out);
  const fetcher = mockTransport();
  const second = new JevClient('second', first.directory, out, 'fake-key', fetcher);
  try {
    const reordered = Object.fromEntries(Object.entries(request).reverse()) as unknown as JevRequest;
    const reused = await second.send(reordered);
    expect(reused.costUsd).toBe(0); expect(fetcher).not.toHaveBeenCalled();
    await second.send(matchingRequest(input, [candidate({ ...row, tags: ['component'] })]));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.requests).toBe(1); expect(second.reusedRequests).toBe(1);
    expect(spendState(second.ledger).knownUsd).toBeCloseTo(2 * 100 * .042 / 1e6);
    expect(readFileSync(second.rawFile, 'utf8')).toContain('sourceRequestId');
  } finally { second.close(); }
});

test('a previously billed unsuccessful request cannot be resent by a later invocation', async () => {
  const fetcher = mockTransport();
  fetcher.mockImplementationOnce(async (_url, init) => new Response(JSON.stringify(response(JSON.parse(String(init?.body)))), { status: 429 }));
  const first = client(fetcher);
  await expect(first.client.send(request)).rejects.toThrow('HTTP 429');
  first.client.close();
  const out = join(first.directory, 'second'); mkdirSync(out);
  const nextFetch = mockTransport(), second = new JevClient('second', first.directory, out, 'fake-key', nextFetch);
  try {
    await expect(second.send(request)).rejects.toThrow('previously billed unsuccessfully');
    expect(nextFetch).not.toHaveBeenCalled(); expect(second.requests).toBe(0);
  } finally { second.close(); }
});

test('missing paid-exchange evidence refuses collection instead of risking a repeated charge', async () => {
  const first = client();
  await first.client.send(request); first.client.close();
  rmSync(first.client.rawFile);
  expect(() => new JevClient('second', first.directory, first.out, 'fake-key')).toThrow('Paid exchange evidence is missing');
  expect(existsSync(first.client.lock)).toBe(false);
});

test('explicit selection rejects holdout, unknown IDs, duplicates and traversal before collection', () => {
  expect(() => options(['--split=holdout', '--cases=measured/dev-selection.json'])).toThrow('dev-only');
  expect(() => options(['--cases=../outside.json'])).toThrow('dev-only');
  const directory = temporary(); mkdirSync(join(directory, 'sources'));
  const file = join(directory, 'sources/selection.json');
  writeFileSync(file, JSON.stringify({ caseIds: [matchCase.id] }));
  expect(requestedSelection([matchCase, macroCase], 'selection.json', directory).cases).toEqual([matchCase]);
  writeFileSync(file, JSON.stringify({ caseIds: [matchCase.id, matchCase.id] }));
  expect(() => requestedSelection([matchCase], 'selection.json', directory)).toThrow('unique');
  writeFileSync(file, JSON.stringify({ caseIds: ['unavailable-or-holdout'] }));
  expect(() => requestedSelection([matchCase], 'selection.json', directory)).toThrow('requested dev tier');
});

test.each(['response-append', 'settle-append', 'response-fsync', 'settle-fsync'])('journal %s failure latches collector stop and retains known billed usage', async fault => {
  const { client: c, fetcher } = client();
  const append = fs.appendFileSync, sync = fs.fsyncSync;
  let failSync = false, injected = false;
  jest.spyOn(fs, 'appendFileSync').mockImplementation((...args: Parameters<typeof fs.appendFileSync>) => {
    const selected = typeof args[1] === 'string' && args[1].includes(`"event":"${fault.startsWith('response') ? 'response' : 'settle'}"`);
    if (selected && !injected) {
      injected = true;
      if (fault.endsWith('append')) throw new Error('Simulated external I/O failure');
      failSync = true;
    }
    append(...args);
  });
  jest.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
    if (failSync) { failSync = false; throw new Error('Simulated external fsync failure'); }
    sync(fd);
  });
  try {
    await expect(c.send(request)).rejects.toThrow('Journal write failed');
    await expect(c.send(request)).rejects.toThrow('stopped');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.knownUsd).toBe(100 * .042 / 1e6);
    expect(c.unknown).toBe(true);
    expect(injected).toBe(true);
  } finally { c.close(); }
});

test('a failed second estimator request preserves the known first-stage subtotal', async () => {
  const fetcher = mockTransport(r => response(r, { calories: 'b1' }));
  fetcher.mockImplementationOnce(async (_url, init) => new Response(JSON.stringify(response(JSON.parse(String(init?.body)), { calories: 'b1' }))));
  fetcher.mockRejectedValueOnce(new Error('Simulated timeout'));
  const { client: c } = client(fetcher);
  try {
    const measured = await evaluateCase(macroCase, jevMethod(c), [row], c);
    expect(measured.costUsd).toBeNull();
    expect(measured.knownCostUsd).toBe(100 * .042 / 1e6);
    expect(score([macroCase], [measured]).knownCostUsd).toBe(measured.knownCostUsd);
    expect(c.stopped).toBeTruthy();
  } finally { c.close(); }
});

test('budget-driven bulk sampling is deterministic, stratified, bounded and shared by compared methods', () => {
  const cases = loadCases('dev', 'both').cases;
  const available = cases.filter(c => c.tier === 'curated').reduce((sum,c) => sum + (c.task === 'macro' ? 2 : 1), 0) + 200;
  const sampled = affordableSelection(cases, available * RESERVATION_USD);
  expect(sampled.sampled).toBe(true);
  expect(sampled.selected.reduce((sum,c) => sum + (c.task === 'macro' ? 2 : 1), 0)).toBeLessThanOrEqual(available);
  expect(sampled.selected.filter(c => c.tier === 'curated')).toHaveLength(cases.filter(c => c.tier === 'curated').length);
  expect(affordableSelection(cases, STOP_USD).sampled).toBe(false);
  expect(stratifiedSample(cases, 25).map(c => c.id)).toEqual(stratifiedSample(cases,25).map(c=>c.id));
});

test('metrics penalize wrong positive IDs, abstentions, omissions, exact zeros, and strict >50% calorie misses', () => {
  const negative: MatchCase = { ...matchCase, id: 'negative', expected: { kind: 'none', matchId: null } };
  const matching = score([matchCase, negative], [result(matchCase.id, { kind: 'match', matchId: 'wrong', confidence: 1 })]);
  expect(matching.wrongMatches).toBe(1); expect(matching.recall).toBe(0); expect(matching.abstentions).toBe(1); expect(matching.passRate).toBe(0);
  const zeros: MacroCase = { ...macroCase, id: 'zero', expected: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
  const measured = score([macroCase, zeros], [result(macroCase.id, { ...row.macros, calories: 150 }), result(zeros.id, { calories: 0, protein: 1, carbs: 0, fat: 0 })]);
  expect(measured.bigMisses).toBe(0); expect(measured.medianPercentError!.calories).toBe(25); expect(measured.zeroCorrectness).toBe(.75);
  expect(percentError(1, 0)).toBe(100);
  const failed = score([macroCase, zeros], [result(macroCase.id, null, { failure: 'timeout', costUsd: null })]);
  expect(failed.bigMissRate).toBe(1); expect(failed.medianPercentError!.fat).toBeNull(); expect(failed.costPer1000Usd).toBeNull();
  expect(failed.zeroCorrectness).toBe(0);
});

test('invalid adapter IDs and outputs become failures through the real evaluator', async () => {
  const r = await evaluateCase(matchCase, { name: 'broken', matcher: { name: 'broken', async match() { return { kind: 'match', matchId: 'foreign', confidence: 1 }; } } }, [row]);
  expect(r.output).toBeNull(); expect(r.failure).toBeTruthy();
});

function toyFixture(split: 'dev' | 'holdout') {
  const dir = temporary(); mkdirSync(join(dir, 'data'));
  const bytes = JSON.stringify({ ...matchCase, split }) + '\n';
  for (const tier of ['curated','bulk']) for (const partition of ['dev','holdout']) {
    writeFileSync(join(dir, `data/${tier}.${partition}.jsonl`), tier === 'curated' && split === partition ? bytes : '\n');
  }
  const rows = JSON.stringify([row]); writeFileSync(join(dir,'data/rows.json'),rows);
  writeFileSync(join(dir,'holdout.sha256'), ['data/curated.holdout.jsonl','data/bulk.holdout.jsonl','data/rows.json']
    .map(p=>`${sha256(readFileSync(join(dir,p)))}  ${p}`).join('\n')+'\n');
  return dir;
}

test('actual runner is offline by default and logs toy holdout success and checksum refusal', async () => {
  const fakeFetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
  const logging = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const dir = toyFixture('holdout');
  const report = await run(['--methods=exact','--split=holdout','--tier=curated'],dir);
  expect(report.scores['curated/matching/exact']!.passRate).toBe(1);
  expect(report.accounting.cumulativeKnownUsd).toBeNull();
  expect(report.accounting.runKnownUsd).toBe(0);
  const file = join(dir,'results/holdout-runs.jsonl');
  expect(readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l).event)).toEqual(['start','end']);
  writeFileSync(join(dir,'data/curated.holdout.jsonl'),'tampered');
  await expect(run(['--split=holdout','--tier=curated'],dir)).rejects.toThrow();
  expect(readFileSync(file,'utf8').trim().split('\n')).toHaveLength(4);
  expect(fakeFetch).not.toHaveBeenCalled(); expect(logging).toHaveBeenCalled();
  // Only synthetic Toy Chain cases execute here; the locked repository holdout is never evaluated.
});

test('missing live credentials yield an actionable secret-safe receipt before any transport', async () => {
  const prior = process.env['TYPESAFE_API_KEY'];
  delete process.env['TYPESAFE_API_KEY'];
  const fetcher = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
  const dir = toyFixture('dev');
  try {
    await expect(run(['--methods=jev-v3','--split=dev','--tier=curated','--live'],dir)).rejects.toThrow('TYPESAFE_API_KEY is missing');
    expect(fetcher).not.toHaveBeenCalled();
    expect(existsSync(join(dir,'results/spend.jsonl'))).toBe(false);
  } finally {
    if (prior === undefined) delete process.env['TYPESAFE_API_KEY']; else process.env['TYPESAFE_API_KEY'] = prior;
  }
});

test('a legacy Jev environment name produces a safe mapping hint without using or disclosing its value', async () => {
  const prior = process.env['TYPESAFE_API_KEY'], legacy = process.env['jev'];
  delete process.env['TYPESAFE_API_KEY']; process.env['jev'] = 'fake-legacy-credential-never-disclose';
  const fetcher = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
  const dir = toyFixture('dev');
  try {
    await expect(run(['--methods=jev-v3','--split=dev','--tier=curated','--live'],dir)).rejects.toThrow('legacy Jev variable named jev');
    expect(fetcher).not.toHaveBeenCalled();
    const failure = join(dir,'results',fs.readdirSync(join(dir,'results'))[0]!,'failure.json');
    expect(readFileSync(failure,'utf8')).not.toContain(process.env['jev']);
  } finally {
    if (prior === undefined) delete process.env['TYPESAFE_API_KEY']; else process.env['TYPESAFE_API_KEY'] = prior;
    if (legacy === undefined) delete process.env['jev']; else process.env['jev'] = legacy;
  }
});
