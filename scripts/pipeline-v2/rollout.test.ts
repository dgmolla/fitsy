import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import * as input from './rollout-input.json';
import { rankHexes, usHexes } from './rollout';
import { baselineFromPoc, estimatePhase } from './rollout-estimate';
import { priorityBatchSchema, readPriorityBatch } from './rollout-priority';
import { parseQueueOptions, runQueueCommand } from './queue-worker';
import { cloudControl } from './cloud-control';
import { parseRunStart } from './cloud-runs';
import { Prisma, type PrismaClient } from '@prisma/client';

const root = resolve(__dirname, '../..'), la = latLngToCell(34.05, -118.25, 7);
const ny = latLngToCell(40.71, -74.01, 7), chicago = latLngToCell(41.88, -87.63, 7);
const dirs: string[] = [];
function directory() { const dir = mkdtempSync(join(tmpdir(), 'v2-rollout-')); dirs.push(dir); return dir; }
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function batch(jobs = gridDisk(la, 1).slice(0, 2).map((hexId, i) => ({ hexId, priority: 100 - i }))) {
  const file = join(directory(), 'batch.json');
  writeFileSync(file, JSON.stringify({ version: 1, phase: 'la-pilot', sourceHash: 'a'.repeat(64), jobs }));
  return file;
}
function poc() {
  return { version: 2, environment: 'dev', status: 'completed', source: { head: 'a'.repeat(40), sourceHash: 'b'.repeat(64) },
    wallTimeComplete: true, unknownUsage: false, interruptedAttempts: 0, costUsd: 0.1, wallMs: 2000,
    coverage: { restaurants: 4, uniqueItems: 10, officialItems: 2, jevItems: 8, persistedItems: 10, rejectedItems: 0 },
    calls: { uberEats: 4, jev: 16 } };
}

test('population orders metros, density orders their cells, and every phase has unique descending queue priorities', () => {
  const nearby = gridDisk(ny, 1).find(id => id !== ny)!;
  const cells = [...gridDisk(la, 1), ...gridDisk(la, 4), ny, nearby, chicago, latLngToCell(21.3, -157.8, 7)];
  const ranked = rankHexes(cells, [{ hexId: chicago, restaurants: 1000, population: 1000 },
    { hexId: nearby, restaurants: 100, population: 100 }, { hexId: ny, restaurants: 1, population: 1 }]);
  expect(new Set(ranked.map(row => row.hexId)).size).toBe(new Set(cells).size);
  expect(ranked.filter(row => row.phase === 'la-pilot')).toHaveLength(7);
  expect(ranked.slice(-4).map(row => row.hexId)).toEqual([nearby, ny, chicago, latLngToCell(21.3, -157.8, 7)]);
  expect(ranked.every((row, i) => row.priority === ranked.length - i)).toBe(true);
  expect(rankHexes([...cells].reverse(), [])).toEqual(rankHexes(cells));
});

test('the national mask preserves holes, antimeridian cells, Alaska and Hawaii while excluding territories', () => {
  const rectangle = (west: number, south: number, east: number, north: number) =>
    [[west, south], [east, south], [east, north], [west, north], [west, south]];
  const states = [
    { code: 'CA', polygons: [{ rings: [rectangle(-118.4, 33.9, -118.1, 34.2), rectangle(-118.3, 34, -118.2, 34.1)] }] },
    { code: 'AK', polygons: [{ rings: [rectangle(179, 60, 181, 61)] }] },
    { code: 'HI', polygons: [{ rings: [rectangle(-158, 21.2, -157.6, 21.5)] }] },
    { code: 'PR', polygons: [{ rings: [rectangle(-66.5, 18, -66, 18.5)] }] },
  ];
  const cells = usHexes({ states });
  expect(cells).not.toContain(la);
  for (const [lat, lng] of [[60.5, 179.5], [60.5, -179.5], [21.3, -157.8]]) expect(cells).toContain(latLngToCell(lat!, lng!, 7));
  expect(cells).not.toContain(latLngToCell(18.2, -66.2, 7));
  expect(new Set(cells).size).toBe(cells.length);
});

test('POC ingestion uses retained accounting and refuses incomplete, unknown or partial measurements', () => {
  expect(baselineFromPoc(poc())).toMatchObject({ costUsd: 0.1, wallMs: 2000, jevCalls: 16 });
  expect(baselineFromPoc({ ...poc(), coverage: { ...poc().coverage, persistedItems: 9, rejectedItems: 1 } }))
    .toMatchObject({ uniqueItems: 10, costUsd: 0.1 });
  for (const changes of [{ wallTimeComplete: false }, { costUsd: null }, { unknownUsage: true }, { source: null },
    { interruptedAttempts: 1 }, { status: 'failed' }, { coverage: { ...poc().coverage, persistedItems: 9 } },
    { coverage: { ...poc().coverage, rejectedItems: 1 } }, { calls: { uberEats: 4, jev: 0 } }]) {
    expect(() => baselineFromPoc({ ...poc(), ...changes })).toThrow();
  }
});

test('estimates retain global UE/daily floors and existing chain savings without skipping location menus', () => {
  const baseline = baselineFromPoc(poc());
  const result = estimatePhase('rest-us', 1000, 30, baseline);
  expect(result.hours).toBeGreaterThanOrEqual((result.ueCalls + result.discoveryCalls) / 0.5 / 3600);
  expect(result.hours).toBeGreaterThanOrEqual(result.jevCalls / input.capacity.jevDailyCalls * 24);
  expect(result.hours).toBeGreaterThanOrEqual(result.jevUsd / input.capacity.jevDailyUsd * 24);
  expect(result.officialSavingsUsd).toBeCloseTo(result.jevUsd * 2 / 8);
  expect(result.ueCalls).toBe(Math.ceil(result.occupiedHexes * 4 * input.capacity.retryFactor));
  expect(estimatePhase('rest-us', 2_000_000, 40_000, baseline).withinBudget).toBe(false);
  const observed = estimatePhase('la-pilot', 2, 1, baseline, { hexes: 2, restaurants: 40 });
  expect(observed.jevUsd).toBeCloseTo(10 * baseline.costUsd * input.capacity.retryFactor);
});

test('priority batches reject duplicates, unordered/overflowed priorities and oversized input', () => {
  expect(readPriorityBatch(batch())).toHaveLength(2);
  for (const jobs of [[{ hexId: la, priority: 1 }, { hexId: la, priority: 0 }],
    [{ hexId: la, priority: 2147483648 }], [{ hexId: la, priority: -1 }], [{ hexId: 'invalid', priority: 1 }],
    gridDisk(la, 1).slice(0, 2).map(hexId => ({ hexId, priority: 1 }))]) {
    expect(() => readPriorityBatch(batch(jobs))).toThrow();
  }
  expect(() => priorityBatchSchema.parse({ version: 1, phase: 'rest-us', sourceHash: 'a'.repeat(64), jobs: [] })).toThrow();
  const file = batch(); writeFileSync(file, ' '.repeat(128 * 1024 + 1));
  expect(() => readPriorityBatch(file)).toThrow('exceeds');
});

test('the real enqueue parser and SQL writer preserve per-hex priorities and refuse all outside-LA input before writing', async () => {
  const file = batch(), jobs = readPriorityBatch(file), queries: Prisma.Sql[] = [];
  const db = { $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(Prisma.sql(strings, ...values)); return [{ hexId: jobs[queries.length - 1]!.hexId }];
  } };
  const options = parseQueueOptions(['enqueue', '--run-id=priority-test', '--priority-file=' + file]);
  expect(await runQueueCommand(db as unknown as PrismaClient, options, 'test-target', { event: 'source' })).toMatchObject({ enqueued: 2 });
  expect(queries.map(sql => sql.values[5])).toEqual(jobs.map(job => job.priority));
  expect(queries.every(sql => sql.sql.includes('GREATEST(hex_jobs.priority, EXCLUDED.priority)'))).toBe(true);
  for (const args of [['--hex-id=' + la], ['--priority=1']]) {
    expect(() => parseQueueOptions(['enqueue', '--run-id=test', '--priority-file=' + file, ...args])).toThrow('cannot be combined');
  }
  expect(() => parseQueueOptions(['enqueue', '--run-id=test', '--priority-file=' + batch([{ hexId: ny, priority: 1 }])])).toThrow('LA');
});

test('cloud control transmits the bounded priority batch and immutable start configuration retains it', async () => {
  const file = batch(), transport = global.fetch;
  const calls: Record<string, unknown>[] = [];
  global.fetch = async (_url, options) => { calls.push(JSON.parse(String(options?.body))); return Response.json({ status: 'running' }); };
  const args = ['start', '--url=http://127.0.0.1:8081', '--run-id=test', '--max-hexes=1', '--budget-usd=1', '--priority-file=' + file]; // loopback test fixture
  try {
    await cloudControl(args);
    expect(calls).toEqual([{ runId: 'test', hexIds: [readPriorityBatch(file)[0]!.hexId], priorities: [100], maxHexes: 1, budgetUsd: 1 }]);
    for (const changes of [{ priorities: [2147483648] }, { priorities: [1, 2] }, { priorities: [] }]) {
      expect(() => parseRunStart({ ...calls[0], ...changes })).toThrow();
    }
    await expect(cloudControl([...args, '--hex-id=' + la])).rejects.toThrow();
    await expect(cloudControl(args.map(arg => arg.startsWith('--priority-file=') ? '--priority-file=' + batch([{ hexId: ny, priority: 1 }]) : arg))).rejects.toThrow();
    expect(calls).toHaveLength(1);
  } finally { global.fetch = transport; }
});

test('the supported offline CLI produces reproducible inventory batches consumed by both queue clients without database access', () => {
  const dir = directory(), inventory = join(dir, 'inventory.json'), connections = join(dir, 'connections');
  writeFileSync(inventory, JSON.stringify({ source: 'captured UE fixture and Census fixture', capturedAt: '2026-10-28T00:00:00Z',
    hexes: [{ hexId: la, restaurants: 20, population: 100 }, { hexId: gridDisk(la, 1)[1], restaurants: 2, population: 20 }] }));
  const run = (out: string, extra: string[] = []) => spawnSync('npm', ['run', 'preload:v2:dev', '--', 'rollout', '--out=' + out, '--inventory=' + inventory, ...extra], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: '--require=' + join(root, 'scripts/test-fixtures/database-client-recorder.cjs'),
      FITSY_TEST_DB_CLIENT_LOG: connections, PIPELINE_DATABASE_URL: 'postgresql://pipeline_writer:never-connect@db.zaxkmjqozvmbifiwbxps.supabase.co/postgres' },
  });
  const out = join(dir, 'first'), first = run(out);
  expect(first.status).toBe(0); expect(first.stderr).toBe(''); expect(existsSync(connections)).toBe(false);
  const summary = JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8'));
  expect(summary).toMatchObject({ baselineKind: 'unmeasured-scenario', geography: 'supplied-inventory-only' });
  const file = join(out, 'la-pilot-0001.json'), jobs = readPriorityBatch(file);
  expect(jobs.map(job => job.hexId)).toEqual([la, gridDisk(la, 1)[1]]);
  expect(parseQueueOptions(['enqueue', '--run-id=test', '--priority-file=' + file]).priorityJobs).toEqual(jobs);
  const secondOut = join(dir, 'second'); expect(run(secondOut).status).toBe(0);
  expect(readFileSync(join(secondOut, 'plan.json'), 'utf8')).toBe(readFileSync(join(out, 'plan.json'), 'utf8'));
  expect(run(out).status).toBe(1);
  expect(readPriorityBatch(file)).toEqual(jobs);
  const report = join(dir, 'completed-poc.json'), measuredOut = join(dir, 'with-poc');
  writeFileSync(report, JSON.stringify(poc()));
  expect(run(measuredOut, ['--poc=' + report]).status).toBe(0);
  expect(JSON.parse(readFileSync(join(measuredOut, 'plan.json'), 'utf8')))
    .toMatchObject({ baselineKind: 'poc-report', baseline: { costUsd: 0.1, wallMs: 2000, restaurants: 4, jevCalls: 16 } });
  const bad = join(dir, 'poc.json'); writeFileSync(bad, JSON.stringify({ ...poc(), unknownUsage: true }));
  expect(run(join(dir, 'bad'), ['--poc=' + bad]).status).toBe(1);
  expect(existsSync(join(dir, 'bad'))).toBe(false);
  // Every pilot center remains inside the current runtime LA boundary.
  expect(jobs.every(job => cellToLatLng(job.hexId)[0] > 33.95)).toBe(true);
});
