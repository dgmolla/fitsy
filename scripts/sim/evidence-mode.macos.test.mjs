import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('owned xcodebuild launch changes only its temporary XCTest capture config to screenshots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-xctest-policy-'));
  const udid = '9E661282-FCE3-4C70-A503-EB2FFA0AD02B';
  try {
    const plist = { '__xctestrun_metadata__': { FormatVersion: 1 }, 'maestro-driver-iosUITests': { PreferredScreenCaptureFormat: 'screenRecording', SystemAttachmentLifetime: 'deleteOnSuccess' } };
    const fixture = (name) => {
      const work = join(dir, name, udid); mkdirSync(work, { recursive: true });
      const config = join(work, 'maestro-driver-ios-config.xctestrun');
      const json = join(work, 'config.json'); writeFileSync(json, JSON.stringify(plist));
      execFileSync('plutil', ['-convert', 'xml1', '-o', config, json]);
      const actual = join(work, 'actual-args.txt');
      const stub = join(work, 'real-xcodebuild');
      writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(actual)}\n`); chmodSync(stub, 0o755);
      const receipt = join(work, 'receipt.jsonl');
      const env = { ...process.env, FITSY_XCTEST_CAPTURE_RECEIPT: receipt, FITSY_XCTEST_SIM_UDID: udid, FITSY_XCODEBUILD_REAL: stub };
      return { config, actual, receipt, env };
    };
    const captureFormat = (config) => JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', config], { encoding: 'utf8' }))['maestro-driver-iosUITests'].PreferredScreenCaptureFormat;
    const valid = fixture('valid-destination');
    const args = ['test-without-building', '-xctestrun', valid.config, '-destination', `id=${udid}`];
    const wrapper = join(import.meta.dirname, 'xcodebuild');
    const launch = spawnSync(wrapper, args, { env: valid.env, encoding: 'utf8' });
    assert.equal(launch.status, 0, launch.stderr);
    const changed = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', valid.config], { encoding: 'utf8' }));
    assert.equal(captureFormat(valid.config), 'screenshots');
    assert.equal(changed['maestro-driver-iosUITests'].SystemAttachmentLifetime, 'deleteOnSuccess');
    assert.match(readFileSync(valid.actual, 'utf8'), /test-without-building/);
    assert.equal(JSON.parse(readFileSync(valid.receipt, 'utf8')).preferredScreenCaptureFormat, 'screenshots');

    const invalid = fixture('wrong-destination');
    assert.equal(captureFormat(invalid.config), 'screenRecording');
    const wrong = spawnSync(wrapper, ['test-without-building', '-xctestrun', invalid.config, '-destination', 'id=another-device'], { env: invalid.env, encoding: 'utf8' });
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /Unexpected Maestro XCTest launch; capture policy cannot be verified/);
    assert.equal(captureFormat(invalid.config), 'screenRecording');
    assert.equal(existsSync(invalid.actual), false, 'wrong destination must not invoke real xcodebuild');
    assert.equal(existsSync(invalid.receipt), false, 'wrong destination must not claim capture readiness');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
