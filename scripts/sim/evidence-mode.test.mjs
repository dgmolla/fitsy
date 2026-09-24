import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceMode, matchesFinalCandidate, runSelection } from './evidence-mode.mjs';

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
  for (const change of [{ result: 'fail' }, { evidenceMode: 'development' }, { appHash: 'other' },
    { backendDeployment: 'other' }, { flows: [{ name: 'welcome', sourceHash: 'other' }] }])
    assert.equal(matchesFinalCandidate({ ...report, ...change }, selected), false);
});

test('owned xcodebuild launch changes only its temporary XCTest capture config to screenshots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-xctest-policy-'));
  const udid = '9E661282-FCE3-4C70-A503-EB2FFA0AD02B';
  try {
    const work = join(dir, udid); mkdirSync(work);
    const config = join(work, 'maestro-driver-ios-config.xctestrun');
    const plist = { '__xctestrun_metadata__': { FormatVersion: 1 }, 'maestro-driver-iosUITests': { PreferredScreenCaptureFormat: 'screenRecording', SystemAttachmentLifetime: 'deleteOnSuccess' } };
    const json = join(work, 'config.json'); writeFileSync(json, JSON.stringify(plist));
    execFileSync('plutil', ['-convert', 'xml1', '-o', config, json]);
    const actual = join(dir, 'actual-args.json');
    const stub = join(dir, 'real-xcodebuild');
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(actual)}\n`); chmodSync(stub, 0o755);
    const receipt = join(dir, 'receipt.jsonl');
    const env = { ...process.env, FITSY_XCTEST_CAPTURE_RECEIPT: receipt, FITSY_XCTEST_SIM_UDID: udid, FITSY_XCODEBUILD_REAL: stub };
    const args = ['test-without-building', '-xctestrun', config, '-destination', `id=${udid}`];
    const wrapper = join(import.meta.dirname, 'xcodebuild');
    const launch = spawnSync(wrapper, args, { env, encoding: 'utf8' });
    assert.equal(launch.status, 0, launch.stderr);
    const changed = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', config], { encoding: 'utf8' }));
    assert.equal(changed['maestro-driver-iosUITests'].PreferredScreenCaptureFormat, 'screenshots');
    assert.equal(changed['maestro-driver-iosUITests'].SystemAttachmentLifetime, 'deleteOnSuccess');
    assert.match(readFileSync(actual, 'utf8'), /test-without-building/);
    assert.equal(JSON.parse(readFileSync(receipt, 'utf8')).preferredScreenCaptureFormat, 'screenshots');
    const wrong = spawnSync(wrapper, ['test-without-building', '-xctestrun', config, '-destination', 'id=another-device'], { env, encoding: 'utf8' });
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /capture policy/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
