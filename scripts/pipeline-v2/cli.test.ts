import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseOptions } from './run';
import { v2Database } from '../preload-v2';
import { latLngToCell } from 'h3-js';

const root = resolve(__dirname, '../..'), hexId = latLngToCell(34.05, -118.25, 7), dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function run(extra: Record<string, string> = {}, directory?: string, cap = '5') {
  const out = directory ?? mkdtempSync(join(tmpdir(), 'v2-cli-')); if (!directory) dirs.push(out);
  const eventsPath = join(out, 'events.jsonl');
  const result = spawnSync(process.execPath, ['--require', join(root, 'scripts/test-fixtures/pipeline-v2-runtime.cjs'), '--import', 'tsx',
    'scripts/preload-v2.ts', `--hex-id=${hexId}`, '--run-id=issue-591', `--out=${out}`, `--cost-cap-usd=${cap}`],
  { cwd: root, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, HOME: process.env.HOME,
    PIPELINE_DATABASE_URL: 'postgresql://test:test@localhost:1/test', TYPESAFE_API_KEY: 'fixture-private-key', V2_TEST_EVENTS: eventsPath, ...extra } }); // loopback test fixture
  return { ...result, out, report: existsSync(join(out, 'report.json')) ? JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) : null,
    events: existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [] };
}

test('real CLI sources one hex, abstains on unreviewed/independent items, persists and checkpoints atomically', () => {
  const result = run();
  expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  expect(result.report).toMatchObject({ status: 'completed', environment: 'dev', coverage: { restaurants: 4, officialItems: 1, jevItems: 4,
    uniqueItems: 5, persistedItems: 5, chainsWithPublishedData: 2, chainsWithoutPublishedData: 1, independentRestaurants: 1 },
    calls: { uberEats: 4, jev: 8, fatSecret: 0, pdfSearch: 0 }, sourceMix: { official:1,jev:4,other:0 }, unknownUsage: false });
  expect(result.report.costUsd).toBeCloseTo(8 * 100 * .042 / 1e6);
  expect(result.report.matches).toMatchObject([{ restaurantId: 'restaurant-0', name: 'Chicken Plate', servingSize: '1 standard chicken plate' }]);
  expect(result.report.pdfJobs).toMatchObject([{ brandId: 'brand-1', status: 'pending' }]);
  expect(result.events.filter((e: { type: string }) => e.type === 'db_commit')).toHaveLength(1);
  expect(result.events.filter((e: { type: string }) => e.type === 'ue_rate_admission')).toHaveLength(4);
  const estimates = result.events.find((e: { type: string }) => e.type === 'db_estimates');
  expect(estimates.sources.filter((s: string) => s === 'official')).toHaveLength(1);
  expect(estimates.sources.filter((s: string) => s === 'jev')).toHaveLength(4);
  expect(estimates.calories[0]).toBe(820);
  expect(result.report.wallMs).toBeGreaterThan(0);
});
test('explicit-hex resume honors the checkpoint without more provider calls', () => {
  const initial = run(), resumed = run({}, initial.out);
  expect(resumed.status).toBe(0); expect(resumed.report.resumedCheckpoint).toBe(true);
  expect(resumed.report.wallMs).toBe(initial.report.wallMs); expect(resumed.report.wallTimeComplete).toBe(true);
  expect(resumed.events.filter((e: { type: string }) => e.type === 'ue_call')).toHaveLength(4);
  expect(resumed.events.filter((e: { type: string }) => e.type === 'jev_call')).toHaveLength(8);
});
test('checkpoint failure leaves no commit and paid requests replay when the DB recovers', () => {
  const failed = run({ V2_TEST_FAIL_CHECKPOINT: '1' });
  expect(failed.status).toBe(1); expect(failed.report.coverage.persistedItems).toBe(0);
  expect(failed.events.some((e: { type: string }) => e.type === 'db_commit')).toBe(false);
  expect(failed.events.some((e: { type: string }) => e.type === 'db_rollback')).toBe(true);
  const resumed = run({}, failed.out); expect(resumed.status).toBe(0);
  expect(resumed.events.filter((e: { type: string }) => e.type === 'jev_call')).toHaveLength(8);
  expect(resumed.report.calls.reusedJev).toBe(8);
  expect(resumed.report.pdfJobs).toHaveLength(1);
});
test('a crash after the checkpoint recovers metrics without claiming complete wall-time evidence', () => {
  const interrupted = run({ V2_TEST_EXIT_AFTER_COMMIT: '1' });
  expect(interrupted.report).toBeNull();
  const resumed = run({}, interrupted.out);
  expect(resumed.status).toBe(0);
  expect(resumed.report).toMatchObject({ status: 'completed', resumedCheckpoint: true, recoveredFrom: 'prepared-before-commit', wallTimeComplete: false,
    coverage: { persistedItems: 5 } });
  expect(resumed.events.filter((e: { type: string }) => e.type === 'jev_call')).toHaveLength(8);
});
test('resume after an interrupted earlier attempt marks execution time as incomplete', () => {
  const interrupted = run({ V2_TEST_EXIT_BETWEEN_RESTAURANTS: '1' }); expect(interrupted.report).toBeNull();
  const resumed = run({}, interrupted.out);
  expect(resumed.status).toBe(0);
  expect(resumed.report).toMatchObject({ status: 'completed', wallTimeComplete: false, interruptedAttempts: 1 });
  expect(resumed.events.filter((e: { type: string }) => e.type === 'jev_call')).toHaveLength(8);
});
test('a cap stop never persists a partial hex or writes a completion checkpoint', () => {
  const result = run({}, undefined, '0'); expect(result.status).toBe(1);
  expect(result.report).toMatchObject({ status: 'spend_cap', coverage: { persistedItems: 0 }, costUsd: 0 });
  expect(result.events.some((e: { type: string }) => e.type === 'jev_call' || e.type === 'db_transaction')).toBe(false);
});
test('the real CLI admits one exact Jev envelope before stopping the next paid request', () => {
  const result = run({}, undefined, '0.000688128');
  expect(result.stderr).toBe(''); expect(result.status).toBe(1);
  expect(result.report).toMatchObject({ status: 'spend_cap', coverage: { persistedItems: 0 }, costUsd: 0.0000042 });
  expect(result.events.filter((e: { type: string }) => e.type === 'budget_reservation')).toEqual([
    { type: 'budget_reservation', service: 'jev', usd: 0.000688128 },
  ]);
  expect(result.events.filter((e: { type: string }) => e.type === 'budget_settlement')).toEqual([
    { type: 'budget_settlement', usd: 0.0000042 },
  ]);
  expect(result.events.filter((e: { type: string }) => e.type === 'jev_call')).toHaveLength(1);
  expect(result.events.some((e: { type: string }) => e.type === 'db_transaction')).toBe(false);
});
test('unknown spend remains unknown on resume and cannot produce a checkpoint', () => {
  const first = run({ V2_TEST_UNKNOWN_USAGE: '1' }), second = run({}, first.out);
  expect(second.status).toBe(1); expect(second.report.costUsd).toBeNull(); expect(second.report.unknownUsage).toBe(true);
  expect(second.events.filter((e: { type: string }) => e.type === 'jev_call')).toHaveLength(1);
  expect(second.events.some((e: { type: string }) => e.type === 'db_transaction')).toBe(false);
});
test('UE failure leaves the hex pending without paid calls', () => {
  const result = run({ V2_TEST_UE_FAIL: '1' }); expect(result.status).toBe(1);
  expect(result.events.some((e: { type: string }) => e.type === 'db_transaction' || e.type === 'jev_call')).toBe(false);
});
test('a missing Jev key fails with an actionable diagnostic and no paid request', () => {
  const result = run({ TYPESAFE_API_KEY: '' }); expect(result.status).toBe(1);
  expect(result.report.failureReason).toBe('TYPESAFE_API_KEY is required');
  expect(result.events.some((e: { type: string }) => e.type === 'db_transaction' || e.type === 'jev_call')).toBe(false);
});
test('the supported root npm command invokes the guarded single-hex entrypoint', () => {
  const result = spawnSync('npm', ['run', 'preload:v2:dev', '--', `--hex-id=${hexId}`, '--run-id=test', '--out=unused', '--cost-cap-usd=6'],
    { cwd: root, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  expect(result.status).toBe(1); expect(result.stderr).toContain('DEV POC cap must be between $0 and $5');
});
test('the guarded CLI inspects and configures the global UE cap with lossless counter output', () => {
  const out = mkdtempSync(join(tmpdir(), 'v2-rate-cli-')); dirs.push(out);
  for (const args of [[], ['--requests-per-second=0.5']]) {
    const result = spawnSync(process.execPath, ['--require', join(root, 'scripts/test-fixtures/pipeline-v2-runtime.cjs'), '--import', 'tsx',
      'scripts/preload-v2.ts', 'ue-rate', ...args], { cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PIPELINE_DATABASE_URL: 'postgresql://test:test@localhost:1/test', V2_TEST_EVENTS: join(out, 'events') } });
    expect(result.stderr).toBe(''); expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ capRps: args.length ? 0.5 : 1, requests: '0', waits: '0', throttles: '0' });
  }
});
test('the rate command rejects invalid caps before any database or provider access', () => {
  const result = spawnSync('npm', ['run', 'preload:v2:dev', '--', 'ue-rate', '--requests-per-second=11'],
    { cwd: root, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  expect(result.status).toBe(1); expect(result.stderr).toContain('UE rate must be 0.01-10');
});
test('overflow is a failed sourced item, never a clipped estimate or completed hex', () => {
  const result = run({ V2_TEST_OVERFLOW: '1' }); expect(result.status).toBe(1);
  expect(result.report).toMatchObject({ status: 'failed', coverage: { persistedItems: 0 }, unknownUsage: false,
    failureReason: 'Jev overflow or incomplete estimate; leave the hex pending' });
  expect(result.events.some((e: { type: string }) => e.type === 'db_transaction')).toBe(false);
});
test('production and administrator credentials are refused before any external call', async () => {
  await expect(v2Database('postgresql://pipeline_writer:fixture@db.zaxkmjqozvmbifiwbxps.supabase.co/postgres')).rejects.toThrow('DEV-only');
  await expect(v2Database('postgresql://postgres:fixture@db.kegycybiruksmrzvniha.supabase.co/postgres')).rejects.toThrow('pipeline_writer');
  const result = run({ PIPELINE_DATABASE_URL: 'postgresql://pipeline_writer:fixture@db.zaxkmjqozvmbifiwbxps.supabase.co/postgres' });
  expect(result.status).toBe(1); expect(result.events).toEqual([]); expect(result.report).toBeNull();
});
test.each([['--phase=both'], [`--hex-id=${hexId}`, '--run-id=poc', '--out=private', '--cost-cap-usd=5.01'],
  ['--hex-id=not-a-hex', '--run-id=poc', '--out=private'], [`--hex-id=${latLngToCell(40, -74, 7)}`, '--run-id=poc', '--out=private'],
  [`--hex-id=${hexId}`, '--hex-id=duplicate', '--run-id=poc', '--out=private']].map(args => ({ args })))('invalid POC scope is refused: $args', ({ args }) => {
  expect(() => parseOptions(args)).toThrow();
});

test('a daily Jev cap stop leaves the hex incomplete without starting a paid request', () => {
  const result = run({ V2_TEST_DAILY_CAP:'1' });
  expect(result.status).toBe(1);
  expect(result.report).toMatchObject({ status:'daily_cap',unknownUsage:false,coverage:{ persistedItems:0 } });
  expect(result.events.some((e:{ type:string })=>e.type==='jev_call' || e.type==='db_commit')).toBe(false);
});
