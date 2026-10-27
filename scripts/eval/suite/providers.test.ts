import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { method, matchingRequest, coarseRequest } from './adapters';
import { durableAppend, loadCases } from './fixtures';
import { spendState } from './budget';
import { ModelClient, ModelSession, MODEL_STOP_USD, providers, providerRequest, reservation, type Provider } from './providers';
import { modelSelection, options, run } from './run';
import { type JevRequest } from '../lib/jev-experiment';
import type { Item } from './types';

const item: Item = { chain: 'Toy Chain', name: 'Beans', section: 'Sides', serving: '1 portion', region: '', description: '' };
const rows = [{ id: 'hidden-id', chain: item.chain, name: item.name, section: item.section, serving: item.serving, region: '' }];
const request = matchingRequest(item, rows), dirs: string[] = [];
const temporary = () => { const d = mkdtempSync(join(tmpdir(), 'fitsy-model-test-')); dirs.push(d); return d; };
afterEach(() => { dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); jest.restoreAllMocks(); });
function answer(r: JevRequest) {
  return { answers: Object.fromEntries(Object.entries(r.questions).map(([name, q]) => {
    const choice = name === 'match' ? 'c0' : name !== 'calories' ? 'zero' : 'b1' in q.criteria ? 'b1' : 'r3';
    return [name, { type: 'choice', choice, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, Number(k === choice)])) }];
  })) };
}
function transport(provider: Provider, change: (data: Record<string, unknown>) => void = () => {}) {
  return jest.fn(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)), r = JSON.parse(payload.messages[0].content);
    const text = JSON.stringify(answer(r)), data: Record<string, unknown> = { model: providers[provider].requiredModel,
      ...(provider === 'haiku' ? { usage: { input_tokens: 500, output_tokens: 100 }, stop_reason: 'end_turn', content: [{ type: 'text', text }] }
        : { usage: { prompt_tokens: 500, completion_tokens: 100, cost: 0.0001 }, choices: [{ message: { content: text }, finish_reason: 'stop' }] }) };
    change(data); return new Response(JSON.stringify(data));
  }) as jest.MockedFunction<typeof fetch>;
}
function setup(provider: Provider, fetcher = transport(provider)) {
  const directory = temporary(), out = join(directory, 'run'); mkdirSync(out);
  const session = new ModelSession('run', directory), client = new ModelClient(provider, session, out, 'fake-secret-never-log', fetcher);
  return { directory, out, session, client, fetcher };
}

test.each<Provider>(['haiku', 'qwen'])('%s uses the identical Jev prompts/state, typed answers and two-stage decoder', async provider => {
  const s = setup(provider), adapter = method(provider, s.client);
  try {
    expect(await adapter.matcher!.match(item, rows)).toEqual({ kind: 'match', matchId: rows[0]!.id, confidence: 1 });
    expect(await adapter.estimator!.estimate(item)).toEqual({ calories: 337.5, protein: 0, carbs: 0, fat: 0 });
    expect(s.client.requests).toBe(3);
    const payload = JSON.parse(String(s.fetcher.mock.calls[0]![1]!.body));
    expect(JSON.parse(payload.messages[0].content)).toEqual({ state: request.state, questions: request.questions });
    expect(JSON.stringify(payload)).not.toContain(rows[0]!.id);
    expect(s.fetcher.mock.calls.map(c => c[0])).toEqual(Array(3).fill(providers[provider].endpoint));
    expect(spendState(s.session.ledger).modelKnownUsd).toBeCloseTo(provider === 'haiku' ? .003 : .0003);
    await adapter.matcher!.match(item, rows);
    expect(s.client.reusedRequests).toBe(1); expect(s.client.requests).toBe(3);
    expect(readFileSync(s.client.rawFile, 'utf8')).not.toContain('fake-secret-never-log');
  } finally { s.client.close(); s.session.close(); }
});

test('the model budget shares the legacy ledger and exclusive lock, survives new runs, and stops before $2.70', async () => {
  const s = setup('haiku');
  expect(() => new ModelSession('other', s.directory)).toThrow();
  try {
    await s.client.send(request);
    const q = new ModelClient('qwen', s.session, s.out, 'fake-key', transport('qwen'));
    await q.send(request); q.close();
    expect(spendState(s.session.ledger).modelKnownUsd).toBeCloseTo(.0011);
  } finally { s.client.close(); s.session.close(); }
  const prefix = readFileSync(s.session.ledger, 'utf8');
  const receipt = { provider: 'qwen', requestId: 'previous', runId: 'previous', at: 'today' };
  durableAppend(s.session.ledger, { ...receipt, event: 'reserve', reserveUsd: 2.69 });
  durableAppend(s.session.ledger, { ...receipt, event: 'settle', costUsd: 2.69 });
  const next = new ModelSession('next', s.directory), fetcher = transport('haiku'), client = new ModelClient('haiku', next, s.out, 'fake-key', fetcher);
  try {
    await expect(client.send(request)).resolves.toMatchObject({ costUsd: 0 });
    await expect(client.send(matchingRequest({ ...item, name: 'Rice' }, rows))).rejects.toThrow('$2.70');
    expect(fetcher).not.toHaveBeenCalled();
    expect(readFileSync(s.session.ledger, 'utf8').startsWith(prefix)).toBe(true);
  } finally { client.close(); next.close(); }
});

test.each<Provider>(['haiku', 'qwen'])('%s unknown usage stops both providers without retry or secret disclosure', async provider => {
  const s = setup(provider, transport(provider, data => { delete data['usage']; data['echo'] = 'fake-secret-never-log'; }));
  try {
    await expect(s.client.send(request)).rejects.toThrow('Credential echo');
    const other = new ModelClient(provider === 'haiku' ? 'qwen' : 'haiku', s.session, s.out, 'fake-key', s.fetcher);
    await expect(other.send(request)).rejects.toThrow('stopped'); other.close();
    expect(s.fetcher).toHaveBeenCalledTimes(1); expect(spendState(s.session.ledger).unknown).toBe(true);
    expect(readFileSync(s.client.rawFile, 'utf8')).not.toContain('fake-secret-never-log');
  } finally { s.client.close(); s.session.close(); }
  expect(() => new ModelSession('later', s.directory)).toThrow('Unknown');
});

test.each<Provider>(['haiku', 'qwen'])('%s billed invalid probabilities remain failed cases without paid retries or stopping other cases', async provider => {
  const s = setup(provider, transport(provider, data => {
    const text = JSON.stringify({ answers: { match: { type: 'choice', choice: 'c0', confidence: 1, probabilities: { c0: 0, none: 0, abstain: 0 } } } });
    if (provider === 'haiku') data['content'] = [{ type: 'text', text }];
    else data['choices'] = [{ message: { content: text }, finish_reason: 'stop' }];
  }));
  try {
    await expect(s.client.send(request)).rejects.toThrow('probability');
    await expect(s.client.send(request)).rejects.toThrow('probability');
    expect(s.fetcher).toHaveBeenCalledTimes(1); expect(spendState(s.session.ledger).modelKnownUsd).toBeGreaterThan(0);
    expect(spendState(s.session.ledger).unknown).toBe(false);
    expect(s.client.stopped).toBeNull();
    s.fetcher.mockImplementationOnce(transport(provider));
    await expect(s.client.send(matchingRequest({ ...item, name: 'Rice' }, rows))).resolves.toBeDefined();
    expect(s.fetcher).toHaveBeenCalledTimes(2);
  } finally { s.client.close(); s.session.close(); }
});

test.each<Provider>(['haiku', 'qwen'])('%s resumes successful and invalid paid outputs across sessions without transport', async provider => {
  const s = setup(provider), badRequest = matchingRequest(item, [...rows, { ...rows[0]!, id: 'another-id' }]);
  await s.client.send(request);
  s.fetcher.mockImplementationOnce(transport(provider, data => {
    // Observed live Haiku failure: individually valid numbers with a total probability of 1.5.
    const text = JSON.stringify({ answers: { match: { type: 'choice', choice: 'abstain', confidence: .45,
      probabilities: { c0: .475, c1: .475, none: .05, abstain: .5 } } } });
    if (provider === 'haiku') data['content'] = [{ type: 'text', text }];
    else data['choices'] = [{ message: { content: text }, finish_reason: 'stop' }];
  }));
  await expect(s.client.send(badRequest)).rejects.toThrow('probability');
  s.client.close(); s.session.close();
  const ledger = readFileSync(s.session.ledger, 'utf8'), out = join(s.directory, 'resumed'); mkdirSync(out);
  const session = new ModelSession('resumed', s.directory), fetcher = transport(provider);
  const client = new ModelClient(provider, session, out, 'fake-key', fetcher);
  try {
    expect(client.hasReplay(request)).toBe(true); expect(client.hasReplay(badRequest)).toBe(true);
    expect(await method(provider, client).matcher!.match(item, rows)).toMatchObject({ kind: 'match', matchId: rows[0]!.id });
    await expect(client.send(badRequest)).rejects.toThrow('probability');
    expect(fetcher).not.toHaveBeenCalled(); expect(client.reusedRequests).toBe(2); expect(client.knownUsd).toBe(0);
    expect(client.stopped).toBeNull(); expect(readFileSync(session.ledger, 'utf8')).toBe(ledger);
  } finally { client.close(); session.close(); }
});

test.each(['missing', 'cost', 'payload'])('model resume refuses %s paid evidence before another request', async corruption => {
  const s = setup('haiku'); await s.client.send(request); s.client.close(); s.session.close();
  if (corruption === 'missing') rmSync(s.client.rawFile);
  else {
    const entries = readFileSync(s.client.rawFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    if (corruption === 'cost') entries.find(e => e.event === 'response').costUsd += .001;
    else entries.find(e => e.event === 'request').payload.messages[0].content = '{}';
    writeFileSync(s.client.rawFile, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  }
  const session = new ModelSession('next', s.directory), fetcher = transport('haiku');
  try {
    expect(() => new ModelClient('haiku', session, s.out, 'fake-key', fetcher)).toThrow(/replay|evidence/);
    expect(fetcher).not.toHaveBeenCalled();
  } finally { session.close(); }
});

test.each(['model identity', 'reserved token/cost envelope'])('a bad answer cannot conceal a fatal %s violation', async violation => {
  const s = setup('haiku', transport('haiku', data => {
    if (violation === 'model identity') data['model'] = 'other-model';
    else data['usage'] = { input_tokens: 500_000, output_tokens: 100 };
    data['stop_reason'] = 'max_tokens';
  }));
  try {
    await expect(s.client.send(request)).rejects.toThrow(violation);
    expect(s.client.stopped).toContain(violation);
    await expect(s.client.send(matchingRequest({ ...item, name: 'Rice' }, rows))).rejects.toThrow('stopped');
    expect(s.fetcher).toHaveBeenCalledTimes(1);
  } finally { s.client.close(); s.session.close(); }
});

test('pending reservations consume the shared allowance and provider identity cannot disappear at settlement', () => {
  const directory = temporary(), session = new ModelSession('run', directory);
  try {
    session.reserve('haiku', 2.69);
    expect(() => session.reserve('qwen', .02)).toThrow('$2.70');
  } finally { session.close(); }
  const ledger = join(temporary(), 'spend.jsonl');
  const base = { requestId: 'x', runId: 'x', at: 'today' };
  durableAppend(ledger, { ...base, provider: 'haiku', event: 'reserve', reserveUsd: 1 });
  durableAppend(ledger, { ...base, event: 'settle', costUsd: 1 });
  expect(() => spendState(ledger)).toThrow('differs');
});

test('four-method sampling is deterministic, dev-only, outcome-independent and bounded for both macro stages', () => {
  const fixture = loadCases('dev', 'both');
  const selected = modelSelection(fixture.cases, fixture.rows, MODEL_STOP_USD, ['haiku', 'qwen']);
  expect(selected.sampled).toBe(true); expect(selected.reservedUpperBoundUsd).toBeLessThanOrEqual(MODEL_STOP_USD);
  expect(selected.fullUpperBoundUsd).toBeGreaterThan(MODEL_STOP_USD);
  expect(selected.selected).toHaveLength(129);
  const again = modelSelection([...fixture.cases].reverse(), fixture.rows, MODEL_STOP_USD, ['haiku', 'qwen']);
  expect(selected.selected.map(c => c.id)).toEqual(again.selected.map(c => c.id));
  for (const tier of ['curated', 'bulk']) for (const task of ['matching', 'macro']) {
    expect(selected.selected.some(c => c.tier === tier && c.task === task)).toBe(true);
  }
  expect(selected.selected.every(c => c.split === 'dev')).toBe(true);
  expect(options(['--methods=exact,jev-v3,haiku,qwen', '--live']).jevReplayOnly).toBe(true);
  expect(() => options(['--methods=qwen', '--live', '--split=holdout'])).toThrow('dev-only');
  expect(reservation('haiku', coarseRequest(item)).usd).toBeGreaterThan(0);
  expect(providerRequest('qwen', request)).toMatchObject({ provider: { allow_fallbacks: false } });
  const resumed = modelSelection(selected.selected, fixture.rows, MODEL_STOP_USD - .004918, ['haiku', 'qwen'],
    provider => provider === 'haiku');
  expect(resumed.selected.map(c => c.id)).toEqual(selected.selected.map(c => c.id));
  expect(resumed.sampled).toBe(false);
});

test.each([false, true])('real four-method entrypoint reports missing keys and legacy-name recovery before transport (aliases=%s)', async aliases => {
  const directory = temporary(), source = loadCases('dev', 'curated');
  // Use actual immutable fixture files for preflight; no holdout case is evaluated.
  const prior = Object.fromEntries(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'anthropic', 'openrouter'].map(k => [k, process.env[k]]));
  delete process.env['ANTHROPIC_API_KEY']; delete process.env['OPENROUTER_API_KEY'];
  for (const key of ['anthropic', 'openrouter']) {
    if (aliases) process.env[key] = 'fake-legacy-secret-never-disclose'; else delete process.env[key];
  }
  const fetcher = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
  try {
    expect(source.cases.every(c => c.split === 'dev')).toBe(true);
    // This invokes the real CLI consumer against repository data; only the result directory is task-owned via a copied fixture.
    const { copyFileSync } = await import('node:fs');
    mkdirSync(join(directory, 'data'));
    for (const file of ['holdout.sha256', 'data/rows.json', 'data/curated.dev.jsonl', 'data/curated.holdout.jsonl', 'data/bulk.holdout.jsonl']) {
      copyFileSync(join(__dirname, file), join(directory, file));
    }
    await expect(run(['--methods=exact,jev-v3,haiku,qwen', '--tier=curated', '--split=dev', '--live'], directory))
      .rejects.toThrow('ANTHROPIC_API_KEY, OPENROUTER_API_KEY');
    expect(fetcher).not.toHaveBeenCalled();
    expect(existsSync(join(directory, 'results/spend.jsonl'))).toBe(false);
    const failure = JSON.parse(readFileSync(join(directory, 'results', readdirSync(join(directory, 'results'))[0]!, 'failure.json'), 'utf8'));
    expect(failure.failure).toContain('no requests were sent');
    expect(JSON.stringify(failure)).not.toContain('fake-legacy-secret-never-disclose');
    if (aliases) {
      expect(failure.failure).toContain('anthropic -> ANTHROPIC_API_KEY');
      expect(failure.failure).toContain('openrouter -> OPENROUTER_API_KEY');
    }
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('real runner consumes both model clients, accounts both estimator stages, and closes its lock', async () => {
  const { copyFileSync, writeFileSync } = await import('node:fs');
  const directory = temporary(), source = loadCases('dev', 'curated'); mkdirSync(join(directory, 'data'));
  for (const file of ['holdout.sha256', 'data/rows.json', 'data/curated.holdout.jsonl', 'data/bulk.holdout.jsonl']) {
    copyFileSync(join(__dirname, file), join(directory, file));
  }
  const cases = ['matching', 'macro'].map(task => source.cases.find(c => c.task === task)!);
  writeFileSync(join(directory, 'data/curated.dev.jsonl'), cases.map(c => JSON.stringify(c)).join('\n') + '\n');
  const prior = Object.fromEntries(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY'].map(k => [k, process.env[k]]));
  process.env['ANTHROPIC_API_KEY'] = 'fake-anthropic'; process.env['OPENROUTER_API_KEY'] = 'fake-openrouter';
  const haiku = transport('haiku'), qwen = transport('qwen');
  jest.spyOn(globalThis, 'fetch').mockImplementation((url, init) => String(url) === providers.haiku.endpoint ? haiku(url, init) : qwen(url, init));
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const report = await run(['--methods=haiku,qwen', '--tier=curated', '--split=dev', '--live'], directory);
    expect(report.stopReason).toBeNull(); expect(report.accounting.requests).toBe(6);
    expect(report.accounting.runKnownUsd).toBeCloseTo(.0033);
    expect(report.accounting.cumulativeKnownUsd).toBeCloseTo(.0033);
    expect(report.scores['curated/matching/haiku']!.attempted).toBe(1);
    expect(report.scores['curated/macro/qwen']!.attempted).toBe(1);
    expect(existsSync(join(directory, 'results/.jev.lock'))).toBe(false);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
