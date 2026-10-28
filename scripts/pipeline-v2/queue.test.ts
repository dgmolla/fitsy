import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { latLngToCell } from 'h3-js';
import { parseQueueOptions } from './queue-worker';
import { retryDelayMs } from './queue';

const hex = latLngToCell(34.05, -118.25, 7);
test('queue options keep explicit DEV scope, fixed per-job limits and the ordinary resume exclusion', () => {
  expect(parseQueueOptions(['enqueue', '--run-id=test', `--hex-id=${hex}`, `--hex-id=${hex}`, '--priority=7', '--max-attempts=4']))
    .toMatchObject({ mode: 'enqueue', runId: 'pipeline-v2-dev:queue:test', hexIds: [hex], priority: 7, maxAttempts: 4, capUsd: 5 });
  expect(parseQueueOptions(['worker', '--run-id=test', '--out=private', '--worker-id=worker-a']))
    .toMatchObject({ runId: 'pipeline-v2-dev:queue:test', maxJobs: 1 });
});
test.each([
  ['enqueue', '--run-id=test'],
  ['enqueue', '--run-id=test', `--hex-id=${latLngToCell(40, -74, 7)}`],
  ['enqueue', '--run-id=test', `--hex-id=${hex}`, '--max-attempts=0'],
  ['enqueue', '--run-id=test', `--hex-id=${hex}`, '--cost-cap-usd=6'],
  ['enqueue', '--run-id=test', `--hex-id=${hex}`, '--run-id=duplicate'],
  ['worker', '--run-id=test', '--out=private'],
  ['worker', '--run-id=test', '--out=private', '--worker-id=a', '--max-jobs=1001'],
  ['worker', '--run-id=test', '--out=private', '--worker-id=a', '--cost-cap-usd=0'],
  ['worker', '--run-id=test', '--out=private', '--worker-id=a', `--hex-id=${hex}`],
])('invalid queue arguments cannot widen scope or change stored budgets: %j', (...args) => {
  expect(() => parseQueueOptions(args)).toThrow();
});
test('retry backoff doubles and stays bounded for the entire supported attempt range', () => {
  expect([1, 2, 3, 7, 100].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 1_800_000, 1_800_000]);
});
test.each(['preload:v2:enqueue', 'preload:v2:worker'])('supported %s command reaches the queue parser', command => {
  const result = spawnSync('npm', ['run', command, '--', '--run-id=test'], {
    cwd: resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(command.endsWith('enqueue') ? 'Enqueue requires explicit' : 'Worker requires');
});
