// #931 gate 2: the hosted scripts shard can be split into jest partitions (FITSY_VERIFY_TEST_PARTITION=i/N). Fast cases only:
// a fake npm records its arguments, so no real suite runs. Partition 1 owns the non-jest side suites and is not run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_')));

function fakeNpmBin(dir, argLog) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npm'), `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argLog)}, args.join(' ') + '\\n');
const outputFile = args.find(a => a.startsWith('--outputFile='));
if (outputFile) fs.writeFileSync(outputFile.slice('--outputFile='.length), JSON.stringify({ success: true, numPassedTests: 1 }));
`, { mode: 0o755 });
  return bin;
}

function run(group, partition) {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-test-sh-partition-'));
  const argLog = join(dir, 'args.log');
  writeFileSync(argLog, '');
  try {
    const bin = fakeNpmBin(dir, argLog);
    const result = spawnSync('bash', [join(root, 'scripts/verify/test.sh'), '--scope=all'], {
      cwd: root, encoding: 'utf8', timeout: 90000,
      env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`, FITSY_VERIFY_TEST_GROUP: group, FITSY_VERIFY_TEST_PARTITION: partition, GITHUB_EVENT_NAME: '' },
    });
    return { result, calls: readFileSync(argLog, 'utf8').split('\n').filter(Boolean) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a scripts partition other than 1 passes --shard to jest and skips the side suites', () => {
  const { result, calls } = run('scripts', '2/4');
  assert.equal(result.status, 0, result.stderr);
  assert.match(calls.find(line => line.includes('--workspace=@fitsy/scripts')), /--shard=2\/4/);
  assert.doesNotMatch(result.stderr, /simple-review|database-roles|loop-recovery/);
});

for (const [partition, group] of [['5/4', 'scripts'], ['0/2', 'scripts'], ['x', 'scripts'], ['1/4', 'api'], ['1/4', '']]) {
  test(`an invalid partition ${partition} for group "${group}" fails before any suite runs`, () => {
    const { result, calls } = run(group, partition);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /invalid FITSY_VERIFY_TEST_PARTITION/);
    assert.deepEqual(calls, []);
  });
}
