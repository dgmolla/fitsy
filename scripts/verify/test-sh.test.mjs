import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_')));

// A fake npm that never runs real Jest: logs its workspace + records a
// minimal valid Jest JSON report so test-results.mjs accepts it. This lets
// the test prove *which* workspaces test.sh actually invokes per shard
// without paying for real suite execution.
function fakeNpmBin(dir, calls) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const script = `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2);
const workspace = args.find(a => a.startsWith('--workspace='));
fs.appendFileSync(${JSON.stringify(calls)}, (workspace || 'unknown') + '\\n');
const outputFile = args.find(a => a.startsWith('--outputFile='));
if (outputFile) fs.writeFileSync(outputFile.slice('--outputFile='.length), JSON.stringify({ success: true, numPassedTests: 1 }));
`;
  writeFileSync(join(bin, 'npm'), script, { mode: 0o755 });
  return bin;
}

for (const shard of ['api', 'scripts', 'mobile']) {
  test(`test.sh --scope=all runs only the ${shard} shard's own workspace (plus shared), not the others`, () => {
    const dir = mkdtempSync(join(tmpdir(), `fitsy-test-sh-${shard}-`));
    const calls = join(dir, 'calls.log');
    writeFileSync(calls, '');
    try {
      const bin = fakeNpmBin(dir, calls);
      const result = spawnSync('bash', [join(root, 'scripts/verify/test.sh'), '--scope=all'], {
        cwd: root, encoding: "utf8", timeout: 90000,
        env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`, FITSY_VERIFY_TEST_GROUP: shard, GITHUB_EVENT_NAME: '' },
      });
      assert.equal(result.status, 0, result.stderr);
      const invokedWorkspaces = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
      assert.deepEqual(new Set(invokedWorkspaces), new Set([`--workspace=@fitsy/${shard}`, '--workspace=@fitsy/shared']));
      const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.equal(parsed.status, 'pass');
      assert.equal(parsed.summary, `whole test groups passed: ${shard}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('an invalid FITSY_VERIFY_TEST_GROUP value fails clearly instead of silently running everything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-test-sh-invalid-'));
  const calls = join(dir, 'calls.log');
  writeFileSync(calls, '');
  try {
    const bin = fakeNpmBin(dir, calls);
    const result = spawnSync('bash', [join(root, 'scripts/verify/test.sh'), '--scope=all'], {
      cwd: root, encoding: "utf8", timeout: 90000,
      env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`, FITSY_VERIFY_TEST_GROUP: 'bogus', GITHUB_EVENT_NAME: '' },
    });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(calls, 'utf8'), '', 'no workspace must run before an invalid shard value is rejected');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with no FITSY_VERIFY_TEST_GROUP set (unsharded/local), every workspace still runs exactly as before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-test-sh-unsharded-'));
  const calls = join(dir, 'calls.log');
  writeFileSync(calls, '');
  try {
    const bin = fakeNpmBin(dir, calls);
    // Also runs the scripts group's own non-sharded side suites for real
    // (unstubbed); slower than the single-shard cases above.
    const result = spawnSync('bash', [join(root, 'scripts/verify/test.sh'), '--scope=all'], {
      cwd: root, encoding: 'utf8', timeout: 180000,
      env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`, GITHUB_EVENT_NAME: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    const invokedWorkspaces = new Set(readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean));
    assert.deepEqual(invokedWorkspaces, new Set(['--workspace=@fitsy/api', '--workspace=@fitsy/scripts', '--workspace=@fitsy/mobile', '--workspace=@fitsy/shared']));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
