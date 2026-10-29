import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { latLngToCell } from 'h3-js';
import { cloudEnvironment } from '../pipeline-cloud-worker';
import { parseRunStart } from './cloud-runs';
import { cloudControl } from './cloud-control';
import { DEV_PROJECT_REF, PROD_PROJECT_REF } from '../lib/db-target-guard';

const hexIds = [34.05, 34.08, 34.11].map(lat => latLngToCell(lat, -118.25, 7));
const start = { runId: 'cloud-test', hexIds, maxHexes: 2, budgetUsd: 0.01 };
const root = resolve(__dirname, '../..');
test('manual starts retain an explicit distinct-hex limit and a finite cumulative budget', () => {
  expect(parseRunStart(start)).toEqual({ ...start, hexIds: hexIds.slice(0, 2) });
  expect(parseRunStart({ ...start, hexIds: [hexIds[0], hexIds[0], hexIds[1]], budgetUsd: 0 })).toMatchObject({ hexIds: hexIds.slice(0, 2), budgetUsd: 0 });
});
test.each([
  { maxHexes: undefined }, { budgetUsd: undefined }, { maxHexes: 0 }, { maxHexes: 1001 }, { maxHexes: 1.5 },
  { budgetUsd: -1 }, { budgetUsd: NaN }, { budgetUsd: Infinity }, { budgetUsd: 5000.01 }, { budgetUsd: 0.0000000001 },
  { hexIds: [] }, { hexIds: ['not-a-hex'] }, { hexIds: [latLngToCell(40, -74, 7)] }, { unknown: true }, { runId: 'cloud:unsafe' },
])('invalid or missing limits fail before any work: %j', changes => {
  expect(() => parseRunStart({ ...start, ...changes })).toThrow('Start requires');
});
test('worker startup validates dedicated DEV credentials and every required runtime secret', async () => {
  const value = `postgresql://pipeline_writer:synthetic@db.${DEV_PROJECT_REF}.supabase.co/postgres`;
  await expect(cloudEnvironment({ PIPELINE_DATABASE_URL: value, TYPESAFE_API_KEY: 'synthetic' })).resolves.toEqual({ url: value+'?connection_limit=2', port: 8080 });
  await expect(cloudEnvironment({ PIPELINE_DATABASE_URL: value, TYPESAFE_API_KEY: ' ' })).rejects.toThrow('TYPESAFE_API_KEY');
  await expect(cloudEnvironment({ PIPELINE_DATABASE_URL: value.replace('pipeline_writer', 'postgres'), TYPESAFE_API_KEY: 'synthetic' })).rejects.toThrow('pipeline_writer');
  await expect(cloudEnvironment({ PIPELINE_DATABASE_URL: value.replace(DEV_PROJECT_REF, PROD_PROJECT_REF), TYPESAFE_API_KEY: 'synthetic',
    FITSY_ALLOW_PROD_WRITE: '1', GITHUB_ACTIONS: 'true', K_SERVICE: 'fitsy-pipeline-prod' })).rejects.toThrow('DEV-only');
  for (const port of ['0', '65536', 'NaN', '1.5']) await expect(cloudEnvironment({ PIPELINE_DATABASE_URL: value,
    TYPESAFE_API_KEY: 'synthetic', PORT: port })).rejects.toThrow('PORT');
  await expect(cloudEnvironment({ PIPELINE_DATABASE_URL:value+'?connection_limit=6', TYPESAFE_API_KEY:'synthetic' })).rejects.toThrow('connection_limit');
});
test.each(['scripts/pipeline-cloud-worker.ts', 'scripts/deploy/pipeline-worker-preflight.ts'])(
  'actual %s startup refuses production before constructing the driver and without credential echoes', entry => {
    const directory = mkdtempSync(join(tmpdir(), 'cloud-preflight-')), log = join(directory, 'connections');
    try {
      const result = spawnSync(process.execPath, ['--require', join(root, 'scripts/test-fixtures/database-client-recorder.cjs'), '--import', 'tsx', entry], {
        cwd: root, encoding: 'utf8', timeout: 15_000,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, PIPELINE_DATABASE_URL: `postgresql://pipeline_writer:never-echo-this@db.${PROD_PROJECT_REF}.supabase.co/postgres`,
          TYPESAFE_API_KEY: 'never-echo-key', FITSY_TEST_DB_CLIENT_LOG: log, FITSY_ALLOW_PROD_WRITE: '1', GITHUB_ACTIONS: 'true' },
      });
      expect(result.status).toBe(1); expect(existsSync(log)).toBe(false);
      expect(result.stderr).not.toContain('never-echo'); expect(result.stdout).toBe('');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
test('the control CLI sends bounded starts without receiving or transmitting database credentials', async () => {
  const transport = global.fetch, calls: { url: string; options: RequestInit | undefined }[] = [];
  global.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ status: 'running' }); };
  try {
    await expect(cloudControl(['start', '--url=http://127.0.0.1:8081', '--run-id=cloud-test', '--max-hexes=1', '--budget-usd=0.01', // loopback test fixture
      ...hexIds.map(hex => '--hex-id=' + hex)])).resolves.toEqual({ status: 'running' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8081/runs'); // loopback test fixture
    expect(JSON.parse(String(calls[0]!.options!.body))).toEqual({ ...start, maxHexes: 1, hexIds: hexIds.slice(0, 1) });
    for (const args of [
      ['start', '--url=http://127.0.0.1:8081', '--run-id=cloud-test', '--hex-id=' + hexIds[0]], // loopback test fixture
      ['start', '--url=https://test.run.app', '--run-id=cloud-test', '--max-hexes=1', '--hex-id=' + hexIds[0]],
      ['status', '--url=https://attacker.test', '--run-id=cloud-test'],
      ['status', '--url=https://test.run.app@attacker.test', '--run-id=cloud-test'],
      ['status', '--url=http://127.0.0.1:8081', '--run-id=cloud-test', '--budget-usd=1'], // loopback test fixture
    ]) await expect(cloudControl(args)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  } finally { global.fetch = transport; }
});
test('the deployment has no writer payloads or public invokers and preflight shares runtime validation', () => {
  const terraform = readFileSync(join(__dirname, 'cloud/main.tf'), 'utf8');
  expect(terraform).toContain('secret_key_ref'); expect(terraform).toContain('cpu_idle          = false');
  expect(terraform).toContain('members  = var.invokers'); expect(terraform).not.toContain('allUsers');
  expect(terraform).not.toMatch(/secret_data|service_account_key/);
  const entry = readFileSync(join(root, 'scripts/pipeline-cloud-worker.ts'), 'utf8');
  const preflight = readFileSync(join(root, 'scripts/deploy/pipeline-worker-preflight.ts'), 'utf8');
  for (const text of [entry, preflight]) { expect(text).toContain('await cloudEnvironment()'); expect(text).toContain('await cloudReadiness(db)'); }
});
