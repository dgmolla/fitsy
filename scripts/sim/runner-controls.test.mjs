import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveFailureEvidence, flowFailureReason, requireMetro, runOwnedMaestro, startOwnedRecorder, stopOwnedRecorder, summarizeCommands, nearestFailure, needsDiagnosis } from './runner-controls.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'fitsy-runner-'));
test('missing Metro fails readiness before the selector timeout', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const start = Date.now();
  await assert.rejects(requireMetro({ pid: 44, processIdentity: 'owned', nativeSourceHash: 'source', configHash: 'config', port },
    { processIdentity: () => 'owned', sourceHash: 'source', configHash: 'config', route: '/bundle' }), /unreachable/);
  assert.ok(Date.now() - start < 2000);
});

test('healthy long command with driver progress outlives the inactivity interval', async () => {
  const dir = temp();
  try {
    const script = "const fs=require('fs');const p=process.argv[1];const tick=setInterval(()=>fs.appendFileSync(p,'.'),70);setTimeout(()=>{clearInterval(tick);process.exit(0)},1150)";
    const result = await runOwnedMaestro(process.execPath, ['-e', script, join(dir, 'maestro.log')],
      { cwd: dir, env: process.env, dir, timeline: join(dir, 'events.jsonl'), flow: 'timeout: 300000', diagnostic: () => { throw Error('unexpected watchdog'); },
        quietMs: 200, wallMs: 2000, pollMs: 20 });
    assert.equal(result.code, 0);
    assert.equal(result.reason, null);
    assert.ok(result.elapsedMs >= 1100);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('watchdog stops its child group and leaves an unrelated process running', async () => {
  const dir = temp();
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    let diagnostics = 0;
    const result = await runOwnedMaestro(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: dir, env: process.env, dir, timeline: join(dir, 'events.jsonl'), flow: '', diagnostic: async () => { diagnostics++; },
        quietMs: 100, wallMs: 1000, pollMs: 20 });
    assert.equal(result.reason, 'inactivity-deadline');
    assert.equal(diagnostics, 1);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    assert.match(readFileSync(join(dir, 'events.jsonl'), 'utf8'), /maestro-end/);
  } finally { unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); }
});

test('recorder stops with its flow and leaves unrelated processes alive', async () => {
  const dir = temp();
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    const file = join(dir, 'video.mp4');
    const script = "process.on('SIGINT',()=>{require('fs').writeFileSync(process.argv[1],'proof');process.exit(0)});setInterval(()=>{},1000)";
    const recorder = await startOwnedRecorder('test-device', file, join(dir, 'recorder.log'),
      { command: process.execPath, args: ['-e', script, file] });
    const result = await stopOwnedRecorder(recorder);
    assert.equal(result.state, 'stopped');
    assert.equal(result.bytes, 5);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally { unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); }
});

test('selector failure preserves deadline, expectation and hierarchy availability', () => {
  const commands = [{ command: { assertConditionCommand: { condition: { visible: { idRegex: 'welcome-start' } }, timeout: '30000' } },
    metadata: { status: 'FAILED', timestamp: 1000, duration: 30000, error: { message: 'not visible', hierarchyRoot: { children: [] } } } }];
  const summary = summarizeCommands(commands);
  assert.equal(summary.commands[0].deadlineMs, 30000);
  assert.equal(summary.commands[0].expected, 'welcome-start');
  assert.deepEqual(nearestFailure(commands).hierarchy, { children: [] });
});

test('long gap is unobserved, overlap is non-additive, and missing receipt is unknown', () => {
  const command = (timestamp, duration) => ({ command: { tapOnElementCommand: {} }, metadata: { status: 'COMPLETED', timestamp, duration } });
  const summary = summarizeCommands([command(1000, 800), command(46000, 1000), command(46500, 1000)]);
  assert.equal(summary.gaps[0].adjacentStartGapMs, 45000);
  assert.equal(summary.gaps[0].precedingDurationMs, 800);
  assert.equal(summary.gaps[0].uncoveredMs, 44200);
  assert.equal(summary.gaps[0].investigationCandidate, true);
  assert.equal(summary.gaps[1].overlaps, true);
  assert.equal(summary.measuredIdleMs, null);
  assert.equal(summarizeCommands(null).observation, 'missing-or-empty');
  const unstamped = summarizeCommands([{ command: { tapOnElementCommand: {} }, metadata: { status: 'COMPLETED' } }]);
  assert.equal(unstamped.observation, 'no-timestamps');
  assert.deepEqual(unstamped.gaps, []);
  assert.equal(unstamped.measuredIdleMs, null);
  const partial = summarizeCommands([command(1000, 800),
    { command: { tapOnElementCommand: {} }, metadata: { status: 'COMPLETED', timestamp: null, duration: null } },
    command(46000, 1000)]);
  assert.equal(partial.observation, 'partial-timestamps');
  assert.equal(partial.commands[1].startMs, null);
  assert.equal(partial.commands[1].durationMs, null);
  assert.equal(partial.gaps[0].uncoveredMs, null);
  assert.equal(partial.gaps[0].investigationCandidate, false);
  const missingDuration = summarizeCommands([command(1000, 800),
    { command: { tapOnElementCommand: {} }, metadata: { status: 'COMPLETED', timestamp: 2000 } },
    command(46000, 1000)]);
  assert.equal(missingDuration.gaps[1].uncoveredMs, null);
  assert.equal(missingDuration.gaps[1].investigationCandidate, false);
});

test('a long parent command covers gaps between nested commands', () => {
  const command = (timestamp, duration) => ({ command: { tapOnElementCommand: {} }, metadata: { status: 'COMPLETED', timestamp, duration } });
  const summary = summarizeCommands([command(1000, 100000), command(11000, 1000), command(51000, 1000)]);
  assert.equal(summary.gaps[1].adjacentStartGapMs, 40000);
  assert.equal(summary.gaps[1].uncoveredMs, 0);
  assert.equal(summary.gaps[1].overlaps, true);
  assert.equal(summary.gaps[1].investigationCandidate, false);
});

test('empty commands and abnormal recorder exit fail before walkthrough', () => {
  const result = { code: 0, reason: null };
  const command = [{ command: { assertConditionCommand: { condition: { visible: { textRegex: 'Ready' } } } }, metadata: { status: 'COMPLETED' } }];
  assert.equal(flowFailureReason(result, [], { state: 'stopped', code: 0, bytes: 5 }), 'missing-or-empty-command-receipt');
  assert.equal(flowFailureReason(result, command, { state: 'stopped', code: 1, bytes: 5 }), 'recorder-failure');
  assert.equal(flowFailureReason(result, command, { state: 'stopped', code: 0, bytes: 5 }), null);
});

test('two matching failures require a diagnosis checkpoint before another run', () => {
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'a' }]), true);
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'b' }]), false);
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'a', diagnosis: { file: 'review.json' } }]), false);
});

test('archived failure history retains each attempt evidence path', () => {
  const first = [{ key: 'a', evidence: '.evidence/product-flow/welcome' }];
  const once = archiveFailureEvidence(first, '.evidence/product-flow', '.evidence/resume/product-flow-first');
  const second = [...once, { key: 'a', evidence: '.evidence/product-flow/welcome' }];
  const twice = archiveFailureEvidence(second, '.evidence/product-flow', '.evidence/resume/product-flow-second');
  assert.equal(twice[0].evidence, '.evidence/resume/product-flow-first/welcome');
  assert.equal(twice[1].evidence, '.evidence/resume/product-flow-second/welcome');
  assert.equal(first[0].evidence, '.evidence/product-flow/welcome');
});

test('required assertion and app identity preflight fails before walkthrough', () => {
  const result = { code: 0, reason: null }, recorder = { state: 'stopped', code: 0, bytes: 5 };
  const config = { command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile', name: 'welcome' } } }, metadata: { status: 'COMPLETED' } };
  const assertion = { command: { assertConditionCommand: { condition: { visible: { textRegex: 'Ready' } } } }, metadata: { status: 'COMPLETED' } };
  assert.equal(flowFailureReason(result, [config], recorder, 'welcome'), 'missing-or-failed-required-assertions');
  assert.equal(flowFailureReason(result, [config, { ...assertion, metadata: { status: 'SKIPPED' } }], recorder, 'welcome'), 'missing-or-failed-required-assertions');
  assert.equal(flowFailureReason(result, [config, assertion], recorder, 'another-flow'), 'wrong-app-or-flow-receipt');
  assert.equal(flowFailureReason(result, [config, assertion], recorder, 'welcome'), null);
});
