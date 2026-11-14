import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceMode, matchesFinalCandidate, runSelection } from './evidence-mode.mjs';
import { runSelectedRecordedFlow } from './product-flow.mjs';
import { runOwnedMaestro } from './runner-controls.mjs';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));

test('the requested-video caller uses supported simctl recording arguments and finalizes its owned recorder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-recorder-'));
  const recorder = join(dir, 'xcrun'), video = join(dir, 'capture.mp4');
  writeFileSync(recorder, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.length !== 6 || args[0] !== 'simctl' || args[1] !== 'io' || args[2] !== 'owned-device' ||
    args[3] !== 'recordVideo' || !/^--codec=(h264|hevc)$/.test(args[4])) process.exit(117);
fs.writeFileSync(args[5], 'recording');
process.on('SIGINT', () => { fs.appendFileSync(args[5], '-finalized'); process.exit(0); });
setInterval(() => {}, 1000);
`);
  chmodSync(recorder, 0o755);
  try {
    const recorded = await runSelectedRecordedFlow({ recordVideo: true }, {
      recorderCommand: recorder, udid: 'owned-device', video, recorderLog: join(dir, 'recorder.log'),
      maestroCommand: process.execPath, maestroArgs: ['-e', 'process.exit(0)'],
      cwd: dir, env: process.env, dir, timeline: join(dir, 'timeline.jsonl'), flow: '', diagnostic: () => {},
    });
    assert.equal(recorded.result.code, 0);
    assert.equal(recorded.result.reason, null);
    assert.equal(recorded.recorderResult.code, 0);
    assert.equal(recorded.recorderResult.endedBeforeStop, false);
    assert.equal(readFileSync(video, 'utf8'), 'recording-finalized');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the real non-recording caller returns on command exit and retains monotonic failure evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-supervisor-'));
  const timeline = join(dir, 'timeline.jsonl');
  const originalTimeout = globalThis.setTimeout;
  let pollTicks = 0;
  globalThis.setTimeout = (callback, ms, ...args) => originalTimeout(() => {
    if (ms === 2000) pollTicks++;
    callback(...args);
  }, ms);
  try {
    for (const code of [0, 7]) {
      const recorded = await runSelectedRecordedFlow({ recordVideo: false }, {
        maestroCommand: process.execPath, maestroArgs: ['-e', `process.exit(${code})`],
        cwd: dir, env: process.env, dir, timeline, flow: '', pollMs: 2000, diagnostic: () => {},
      });
      assert.equal(recorded.result.code, code);
      assert.equal(recorded.result.reason, null);
      assert.equal(recorded.recorderResult.state, 'skipped');
      const timing = recorded.result.supervisorTiming;
      assert.ok(BigInt(timing.dispatch.monotonicNs) <= BigInt(timing.exitObservedMonotonicNs));
      assert.ok(BigInt(timing.exitObservedMonotonicNs) <= BigInt(timing.returnPrepared.monotonicNs));
      assert.ok(timing.exitToReturnMs >= 0);
      assert.equal(timing.uiReady, 'unobserved');
    }
    assert.equal(pollTicks, 0, 'completed children must not wait for the watchdog poll');
    const ends = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse).filter(row => row.type === 'maestro-end');
    assert.deepEqual(ends.map(row => row.outcome), ['pass', 'fail']);
    assert.deepEqual(ends.map(row => row.exitCode), [0, 7]);
    assert.ok(ends.every(row => row.supervisorTiming.exitObservedMonotonicNs));
  } finally {
    globalThis.setTimeout = originalTimeout;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('event-driven completion retains bounded inactivity stops and diagnostics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-inactivity-'));
  const timeline = join(dir, 'timeline.jsonl'), diagnostics = [];
  try {
    const result = await runOwnedMaestro(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      cwd: dir, env: process.env, dir, timeline, flow: '', pollMs: 20, quietMs: 80,
      diagnostic: reason => diagnostics.push(reason),
    });
    assert.equal(result.reason, 'inactivity-deadline');
    assert.notEqual(result.code, 0);
    assert.deepEqual(diagnostics, ['inactivity-deadline']);
    const rows = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.at(-1).outcome, 'inactivity-deadline');
    for (const pid of [rows[0].pid, rows[0].commandPid])
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
    const result = spawnSync(join(moduleDir, 'xcodebuild'),
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

test('valid XCTest launch rewrites capture policy and records proof on every platform', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-capture-portable-'));
  const udid = '9E661282-FCE3-4C70-A503-EB2FFA0AD02B';
  try {
    const work = join(dir, udid); mkdirSync(work);
    const config = join(work, 'maestro-driver-ios-config.xctestrun');
    const suite = 'maestro-driver-iosUITests';
    writeFileSync(config, JSON.stringify({ '__xctestrun_metadata__': { FormatVersion: 1 },
      [suite]: { PreferredScreenCaptureFormat: 'screenRecording', SystemAttachmentLifetime: 'deleteOnSuccess' } }));
    const plistTools = join(dir, 'plist-tools.cjs');
    writeFileSync(plistTools, `const child = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { readFileSync, realpathSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const original = child.execFileSync;
child.execFileSync = (command, args, options) => {
  const file = realpathSync(process.env.FITSY_XCTEST_FAKE_PLIST);
  if (command === 'plutil') {
    assert.deepEqual(args, ['-convert', 'json', '-o', '-', file]);
    return readFileSync(file, 'utf8');
  }
  if (command === '/usr/libexec/PlistBuddy') {
    assert.deepEqual(args, ['-c', 'Set :maestro-driver-iosUITests:PreferredScreenCaptureFormat screenshots', file]);
    const plist = JSON.parse(readFileSync(file, 'utf8'));
    plist['maestro-driver-iosUITests'].PreferredScreenCaptureFormat = 'screenshots';
    writeFileSync(file, JSON.stringify(plist));
    return '';
  }
  return original(command, args, options);
};
syncBuiltinESMExports();
`);
    const actual = join(dir, 'real-xcodebuild-invoked');
    const real = join(dir, 'real-xcodebuild');
    writeFileSync(real, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(actual)}\n`); chmodSync(real, 0o755);
    const receipt = join(dir, 'capture.jsonl');
    const result = spawnSync(join(moduleDir, 'xcodebuild'),
      ['test-without-building', '-xctestrun', config, '-destination', `id=${udid}`],
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--require=${plistTools}`,
        FITSY_XCTEST_FAKE_PLIST: config, FITSY_XCTEST_CAPTURE_RECEIPT: receipt,
        FITSY_XCTEST_SIM_UDID: udid, FITSY_XCODEBUILD_REAL: real } });
    assert.equal(result.status, 0, result.stderr);
    const changed = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(changed[suite].PreferredScreenCaptureFormat, 'screenshots');
    assert.equal(changed[suite].SystemAttachmentLifetime, 'deleteOnSuccess');
    assert.match(readFileSync(actual, 'utf8'), /test-without-building/);
    assert.equal(JSON.parse(readFileSync(receipt, 'utf8')).preferredScreenCaptureFormat, 'screenshots');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('development and final candidate omit recording unless explicitly requested', () => {
  assert.deepEqual(runSelection(['device', 'billing']).mode, { name: 'development', recordVideo: false, publishable: false });
  assert.deepEqual(runSelection(['device', 'billing', '--mode=final-candidate']).names, ['billing']);
  assert.equal(runSelection(['device', '--mode=final-candidate']).mode.publishable, true);
  assert.equal(runSelection(['device', '--mode=final-candidate']).mode.recordVideo, false);
  assert.deepEqual(runSelection(['device', 'billing', '--mode=final-candidate', '--record-video']).names, ['billing']);
  assert.equal(runSelection(['device', '--mode=final-candidate', '--record-video']).mode.recordVideo, true);
  assert.equal(runSelection(['device', '--record-video']).mode.recordVideo, true);
  assert.equal(evidenceMode('requested-video').recordVideo, true);
  assert.equal(evidenceMode('requested-video').publishable, false);
  assert.throws(() => runSelection(['device', '--mode=development', '--mode=final-candidate']), /exactly one/);
  assert.throws(() => runSelection(['device', '--record-video', '--record-video']), /at most once/);
  assert.throws(() => runSelection(['device', '--record-videos']), /Unknown run option/);
  assert.throws(() => runSelection(['device', '--mode=unknown']), /Unknown evidence mode/);
});

test('the final-candidate CLI admits only the scoped release option and preserves a consumed retry', () => {
  const selection = runSelection(['owned-device', '--mode=final-candidate', '--release-exception=6716597294', '--no-environment-retry']);
  assert.equal(selection.approvalId, '6716597294');
  assert.equal(selection.environmentRetryAllowed, false);
  assert.deepEqual(selection.names, []);
  assert.equal(selection.mode.publishable, true);
  assert.throws(() => runSelection(['owned-device', '--release-exception=735']), /Unknown/);
  assert.throws(() => runSelection(['owned-device', '--release-exception=6716597294', '--release-exception=6716597294']), /repeated/);
  assert.throws(() => runSelection(['owned-device', '--no-environment-retry', '--no-environment-retry']), /at most once/);
});

test('#860: --skip-billing-personas parses alongside --reason, never alone, and never swallows the reason value as a flow name', () => {
  const selection = runSelection(['device', 'cold-start-welcome', '--mode=final-candidate',
    '--skip-billing-personas', '--reason', 'Dawit 5:07 PM PT Nov 13, #853']);
  assert.equal(selection.skipBillingPersonas, true);
  assert.equal(selection.skipBillingReason, 'Dawit 5:07 PM PT Nov 13, #853');
  assert.deepEqual(selection.names, ['cold-start-welcome']);
  assert.equal(selection.mode.publishable, true);
  const unset = runSelection(['device', 'cold-start-welcome']);
  assert.equal(unset.skipBillingPersonas, false);
  assert.equal(unset.skipBillingReason, undefined);
  assert.throws(() => runSelection(['device', '--skip-billing-personas']), /requires --reason/);
  assert.throws(() => runSelection(['device', '--reason', 'no flag']), /requires --reason/);
  assert.throws(() => runSelection(['device', '--skip-billing-personas', '--reason', 'x', '--skip-billing-personas', '--reason', 'y']),
    /at most once/);
});

test('a final candidate reuses complete supersets only with the same passing source-bound inputs', () => {
  const selected = { udid: 'device', appHash: 'app', configHash: 'config', backendDeployment: 'backend', fixture: 'fixture',
    flows: [{ name: 'welcome', sourceHash: 'source' }] };
  const report = { result: 'pass', evidenceMode: 'final-candidate', simulator: 'device', appHash: 'app', configHash: 'config',
    backendDeployment: 'backend', fixture: 'fixture', flows: [{ name: 'welcome', sourceHash: 'source' }] };
  assert.equal(matchesFinalCandidate(report, selected), true);
  const extra = { name: 'signin', sourceHash: 'signin-source' };
  assert.equal(matchesFinalCandidate({ ...report, flows: [extra, ...report.flows] }, selected), true,
    'an extra completed journey does not justify replaying already-covered selection');
  assert.equal(matchesFinalCandidate({ ...report, flows: [extra, ...report.flows] },
    { ...selected, flows: [...report.flows, extra] }), true, 'flow order is not an acceptance input');
  assert.equal(matchesFinalCandidate(report, { ...selected, flows: [...report.flows, extra] }), false,
    'missing coverage still requires execution');
  assert.equal(matchesFinalCandidate(report, { ...selected, flows: [] }), false);
  assert.equal(matchesFinalCandidate({ ...report, flows: [...report.flows, ...report.flows] }, selected), false);
  assert.equal(matchesFinalCandidate(report, { ...selected, recordVideo: true }), false);
  assert.equal(matchesFinalCandidate({ ...report, videoRequested: true }, { ...selected, recordVideo: true }), true);
  assert.equal(matchesFinalCandidate({ ...report, flows: [{ ...report.flows[0], video: 'welcome.mp4', videoHash: 'hash' }] },
    { ...selected, recordVideo: true }), true, 'legacy complete recorded report');
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
