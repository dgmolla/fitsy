import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceMode, matchesFinalCandidate, runSelection } from './evidence-mode.mjs';

test('wrong XCTest destination is rejected before plist tools or real xcodebuild on every platform', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-destination-'));
  const udid = '9E661282-FCE3-4C70-A503-EB2FFA0AD02B';
  try {
    const work = join(dir, udid); mkdirSync(work);
    const config = join(work, 'maestro-driver-ios-config.xctestrun');
    const original = 'unmodified config fixture'; writeFileSync(config, original);
    const actual = join(dir, 'real-xcodebuild-invoked');
    const real = join(dir, 'real-xcodebuild');
    writeFileSync(real, `#!/bin/sh\ntouch ${JSON.stringify(actual)}\n`); chmodSync(real, 0o755);
    const receipt = join(dir, 'capture.jsonl');
    const result = spawnSync(join(import.meta.dirname, 'xcodebuild'),
      ['test-without-building', '-xctestrun', config, '-destination', 'id=another-device'],
      { encoding: 'utf8', env: { ...process.env, FITSY_XCTEST_CAPTURE_RECEIPT: receipt,
        FITSY_XCTEST_SIM_UDID: udid, FITSY_XCODEBUILD_REAL: real } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unexpected Maestro XCTest launch; capture policy cannot be verified/);
    assert.doesNotMatch(result.stderr, /Unknown XCTest capture configuration|Unexpected XCTest configuration path/);
    assert.equal(readFileSync(config, 'utf8'), original);
    assert.equal(existsSync(actual), false, 'wrong destination must not invoke real xcodebuild');
    assert.equal(existsSync(receipt), false, 'wrong destination must not claim capture readiness');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('development is the default; recording requires an explicit run mode', () => {
  assert.deepEqual(runSelection(['device', 'billing']).mode, { name: 'development', recordVideo: false, publishable: false });
  assert.deepEqual(runSelection(['device', 'billing', '--mode=final-candidate']).names, ['billing']);
  assert.equal(runSelection(['device', '--mode=final-candidate']).mode.publishable, true);
  assert.equal(evidenceMode('requested-video').recordVideo, true);
  assert.equal(evidenceMode('requested-video').publishable, false);
  assert.throws(() => runSelection(['device', '--mode=development', '--mode=final-candidate']), /exactly one/);
  assert.throws(() => runSelection(['device', '--mode=unknown']), /Unknown evidence mode/);
});

test('a final candidate is reused only for the same passing source-bound selection', () => {
  const selected = { udid: 'device', appHash: 'app', configHash: 'config', backendDeployment: 'backend', fixture: 'fixture',
    flows: [{ name: 'welcome', sourceHash: 'source' }] };
  const report = { result: 'pass', evidenceMode: 'final-candidate', simulator: 'device', appHash: 'app', configHash: 'config',
    backendDeployment: 'backend', fixture: 'fixture', flows: [{ name: 'welcome', sourceHash: 'source' }] };
  assert.equal(matchesFinalCandidate(report, selected), true);
  const mismatches = [
    ['status', { result: 'fail' }],
    ['mode', { evidenceMode: 'development' }],
    ['simulator', { simulator: 'other' }],
    ['app hash', { appHash: 'other' }],
    ['configuration hash', { configHash: 'other' }],
    ['backend deployment', { backendDeployment: 'other' }],
    ['fixture', { fixture: 'other' }],
    ['flow count', { flows: [] }],
    ['flow name', { flows: [{ name: 'other', sourceHash: 'source' }] }],
    ['flow source hash', { flows: [{ name: 'welcome', sourceHash: 'other' }] }],
  ];
  for (const [field, change] of mismatches)
    assert.equal(matchesFinalCandidate({ ...report, ...change }, selected), false, field);
  assert.equal(matchesFinalCandidate(null, selected), false, 'missing report');
});
