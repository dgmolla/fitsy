import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

function run(items = 2, cap = '15', extra: string[] = [], directory?: string, env: Record<string, string> = {}) {
  const dir = directory ?? mkdtempSync(join(tmpdir(), 'preload-cost-e2e-'));
  if (!directory) directories.push(dir);
  const eventsFile = join(dir, 'events.jsonl');
  const result = spawnSync(process.execPath, [
    '--require', join(__dirname, 'test-fixtures/preload-cost-runtime.cjs'), '--import', 'tsx',
    'scripts/preload-ue-first.ts', '--phase=enrich', ...(env.PRELOAD_TEST_PREFLIGHT ? [] : ['--skip-preflight']), '--run-id=test-cost',
    '--cost-cap-usd', cap, '--cost-log', join(dir, 'cost.jsonl'), ...extra,
  ], { cwd: root, encoding: 'utf8', timeout: 30_000, env: {
    PATH: process.env.PATH, HOME: process.env.HOME,
    POSTGRES_PRISMA_URL: 'postgresql://test:test@localhost:1/test',
    PIPELINE_DATABASE_URL: 'postgresql://test:test@localhost:1/test',
    POSTGRES_URL_NON_POOLING: 'postgresql://test:test@localhost:1/test',
    ANTHROPIC_API_KEY: 'test-key', AXIOM_TOKEN: 'test-token',
    UE_LOC_COOKIE: encodeURIComponent(JSON.stringify({ latitude: 34.05, longitude: -118.25 })),
    PRELOAD_TEST_EVENTS: eventsFile, PRELOAD_TEST_ITEMS: String(items),
    ...env,
  } });
  const events: Record<string, unknown>[] = readFileSync(eventsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { ...result, events, dir };
}

it('reports actual usage from the CLI through the hex checkpoint and run summary', () => {
  const result = run();
  expect(result.stderr + result.stdout).not.toMatch(/fatal|aborted \(strict\)/);
  expect(result.status).toBe(0);
  expect(result.events.find(e => e.type === 'cost_checkpoint')?.cumulativeCost).toBeCloseTo(0.011);
  expect(result.events.find(e => e.type === 'run')?.costTotal).toBeCloseTo(0.011);
  expect(result.events.find(e => e.type === 'restaurant')?.aiUsage).toMatchObject({ inputTokens: 1000, outputTokens: 2000, costUsd: 0.011 });
  expect(result.events.find(e => e.type === 'cost_checkpoint')?.hexUsage).toMatchObject({ inputTokens: 1000, outputTokens: 2000, costUsd: 0.011 });
  expect(result.events.filter(e => e.type === 'db_checkpoint')).toHaveLength(1);
  expect(result.stdout).toContain('cost_per_1k_items=$5.500000');
});

it('stops between chunks, leaves the hex pending, and retains spend when resumed', () => {
  const result = run(51, '0.005');
  expect(result.status).toBe(0);
  expect(result.events.filter(e => e.type === 'ai_request')).toHaveLength(1);
  expect(result.events.filter(e => e.type === 'db_checkpoint')).toHaveLength(0);
  expect(result.events.find(e => e.type === 'run')?.status).toBe('spend_cap');
  const resumed = run(51, '0.005', [], result.dir);
  expect(resumed.status).toBe(0);
  expect(resumed.events.filter(e => e.type === 'ai_request')).toHaveLength(1);
  const raised = run(51, '1', [], result.dir);
  expect(raised.status).toBe(0);
  expect(raised.events.filter(e => e.type === 'ai_request')).toHaveLength(3);
  expect(raised.events.filter(e => e.type === 'db_checkpoint')).toHaveLength(1);
  expect(raised.events.filter(e => e.type === 'run').at(-1)).toMatchObject({ costTotal: 0.033, status: 'completed', hexesCompleted: 1 });
});

it('drains concurrent billable responses before stopping and emitting final totals', () => {
  const result = run(51, '0.005', [], undefined, { PRELOAD_TEST_RESTAURANTS: '3', PRELOAD_TEST_DELAY: '1' });
  expect(result.status).toBe(0);
  expect(result.events.filter(e => e.type === 'ai_request')).toHaveLength(3);
  expect(result.events.filter(e => e.type === 'ai_usage')).toHaveLength(3);
  expect(result.events.filter(e => e.type === 'db_checkpoint')).toHaveLength(0);
  expect(result.events.find(e => e.type === 'run')).toMatchObject({ status: 'spend_cap', costTotal: 0.033, hexesCompleted: 0 });
  const summary = result.events.findIndex(e => e.type === 'run');
  expect(result.events.slice(summary + 1).some(e => e.type === 'ai_usage')).toBe(false);
  expect(result.events.at(-1)?.type).toBe('db_disconnect');
});

it('charges malformed responses and retries instead of reporting only the successful attempt', () => {
  const result = run(2, '15', [], undefined, { PRELOAD_TEST_MALFORMED_ONCE: '1' });
  expect(result.status).toBe(0);
  expect(result.events.filter(e => e.type === 'ai_usage')).toHaveLength(2);
  expect(result.events.find(e => e.type === 'run')).toMatchObject({ costTotal: 0.022, aiUsage: { requests: 2, itemAttempts: 4 } });
});

it('does not retry a billed malformed response after it consumes the spend cap', () => {
  const result = run(2, '0.005', [], undefined, { PRELOAD_TEST_MALFORMED_ONCE: '1' });
  expect(result.status).toBe(0);
  expect(result.events.filter(e => e.type === 'ai_request')).toHaveLength(1);
  expect(result.events.find(e => e.type === 'run')).toMatchObject({ costTotal: 0.011, status: 'spend_cap' });
});

it('treats dry-run AI calls as paid usage and prints zero safely when the cap is zero', () => {
  const dry = run(2, '15', ['--dry-run']);
  expect(dry.status).toBe(0);
  expect(dry.events.some(e => e.type === 'db_transaction' || e.type === 'db_checkpoint')).toBe(false);
  expect(dry.events.find(e => e.type === 'run')?.costTotal).toBe(0.011);
  const stopped = run(2, '0');
  expect(stopped.status).toBe(0);
  expect(stopped.events.some(e => e.type === 'ai_request')).toBe(false);
  expect(stopped.stdout).toContain('cost_per_1k_items=$0.000000');
});

it('stops without retries if a response lacks usage data', () => {
  const result = run(2, '15', [], undefined, { PRELOAD_TEST_INVALID_USAGE: '1' });
  expect(result.status).toBe(1);
  expect(result.events.filter(e => e.type === 'ai_request')).toHaveLength(1);
  expect(result.events.some(e => e.type === 'db_checkpoint')).toBe(false);
  expect(result.events.find(e => e.type === 'run')?.status).toBe('failed');
});

it('uses an unbilled credential preflight rather than sending an untracked AI ping', () => {
  const result = run(2, '15', [], undefined, { PRELOAD_TEST_PREFLIGHT: '1' });
  expect(result.status).toBe(0);
  expect(result.events.find(e => e.type === 'preflight')?.method).toBe('GET');
  expect(result.events.filter(e => e.type === 'ai_usage')).toHaveLength(1);
});

it('restores spend without Axiom and reports an immediate resumed cap stop', () => {
  const initial = run(51, '0.005', [], undefined, { AXIOM_TOKEN: '' });
  expect(initial.status).toBe(0);
  expect(initial.events.some(e => e.type === 'run' || e.type === 'cost_checkpoint')).toBe(false);
  const resumed = run(51, '0.005', [], initial.dir);
  expect(resumed.status).toBe(0);
  expect(resumed.events.find(e => e.type === 'run')).toMatchObject({ costTotal: 0.011, status: 'spend_cap', aiUsage: { inputTokens: 1000, outputTokens: 2000 } });
  expect(resumed.events.filter(e => e.type === 'ai_request')).toHaveLength(1);
});

it('guards retries from the real SDK when another request exhausts the cap during backoff', () => {
  const result = run(2, '0.005', [], undefined, { PRELOAD_TEST_REAL_SDK: '1', PRELOAD_TEST_RESTAURANTS: '2' });
  expect(result.status).toBe(0);
  // One 429 and one paid response. A hidden SDK retry would make a third request.
  expect(result.events.filter(e => e.type === 'ai_request')).toHaveLength(2);
  expect(result.events.filter(e => e.type === 'ai_usage')).toHaveLength(1);
  expect(result.events.find(e => e.type === 'run')).toMatchObject({ status: 'spend_cap', costTotal: 0.011 });
  expect(result.events.some(e => e.type === 'db_checkpoint')).toBe(false);
});

it('preserves an in-flight accounting failure when another worker has already stopped at the cap', () => {
  const result = run(51, '0.005', [], undefined, {
    PRELOAD_TEST_RESTAURANTS: '2', PRELOAD_TEST_DELAY: '1', PRELOAD_TEST_INVALID_USAGE_CALL: '2',
  });
  expect(result.status).toBe(1);
  expect(result.events.filter(e => e.type === 'ai_request')).toHaveLength(2);
  expect(result.events.find(e => e.type === 'run')).toMatchObject({ status: 'failed', costTotal: 0.011 });
  expect(result.events.some(e => e.type === 'db_checkpoint')).toBe(false);
});

it('reports actual completed hexes and cost for a single-hex sample of a larger run', () => {
  const result = run(2, '15', ['--max-hexes', '1'], undefined, { PRELOAD_TEST_RESTAURANTS: '2', PRELOAD_TEST_SPLIT_HEXES: '1' });
  expect(result.status).toBe(0);
  expect(result.events.filter(e => e.type === 'db_checkpoint')).toHaveLength(1);
  expect(result.events.find(e => e.type === 'run')).toMatchObject({ hexesCompleted: 1, hexesTotal: 2, costTotal: 0.011 });
});
