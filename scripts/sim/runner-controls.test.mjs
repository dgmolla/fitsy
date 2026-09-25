import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRecordedFlowFailure, applyCapturePolicy, archiveFailureEvidence, completeMaestroRun, flowFailureReason, recordFlowOutcome, recordedFlowFailureKey, recordRunFailure, requireMetro, runOwnedMaestro, runRecordedFlow, saveRecordedFlowReceipts, startOwnedRecorder, stopOwnedRecorder, summarizeCommands, summarizeFlowTiming, nearestFailure, matchingFailureKey, needsDiagnosis } from './runner-controls.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'fitsy-runner-'));
test('final timeline failure leaves a failed report and retains the triggering error', () => {
  const dir = temp(), reportFile = join(dir, 'report.json');
  const report = { result: 'running', flows: [{ name: 'welcome' }] };
  try {
    writeFileSync(reportFile, JSON.stringify(report));
    let original;
    try { completeMaestroRun(reportFile, dir, report); }
    catch (error) { original = error; }
    assert.match(original?.message || '', /EISDIR/);
    const evidenceErrors = recordRunFailure(reportFile, dir, original);
    assert.match(evidenceErrors.join(' '), /timeline:.*EISDIR/);
    assert.equal(JSON.parse(readFileSync(reportFile, 'utf8')).result, 'fail');
    assert.match(JSON.parse(readFileSync(reportFile, 'utf8')).infrastructureError, /EISDIR/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed report transition invalidates an already finishable report', () => {
  const dir = temp(), reportFile = join(dir, 'report.json'), timeline = join(dir, 'events.jsonl');
  try {
    writeFileSync(reportFile, JSON.stringify({ result: 'awaiting-walkthrough' }));
    writeFileSync(timeline, '');
    assert.deepEqual(recordRunFailure(reportFile, timeline, Error('write failed')), []);
    assert.equal(JSON.parse(readFileSync(reportFile, 'utf8')).result, 'fail');
    assert.match(readFileSync(timeline, 'utf8'), /"outcome":"fail"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
async function assertProcessStopped(pid, deadlineMs = 1500) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    let state = '';
    try { state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim(); }
    catch { return; }
    if (state.startsWith('Z')) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `process ${pid} remains live after group cleanup`);
}
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

test('development flow consumes the owned Maestro command receipt and rejects a no-op', async () => {
  const dir = temp(), timeline = join(dir, 'timeline.jsonl'), video = join(dir, 'video.mp4');
  const commandFile = join(dir, 'commands-test.json');
  const commands = [{ command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile', name: 'welcome' } } }, metadata: { status: 'COMPLETED' } },
    { command: { assertConditionCommand: { condition: { visible: { textRegex: 'Ready' } } } }, metadata: { status: 'COMPLETED' } }];
  try {
    const recorded = await runRecordedFlow({ recordVideo: false,
      maestroCommand: process.execPath, maestroArgs: ['-e', "require('fs').writeFileSync(process.argv[1], process.argv[2])", commandFile, JSON.stringify(commands)],
      udid: 'fixture', video, recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env, dir, timeline,
      flow: 'assertVisible: Ready', diagnostic: async () => {} });
    assert.equal(recorded.result.code, 0);
    assert.equal(recorded.recorderResult.state, 'skipped');
    assert.equal(existsSync(video), false);
    const emitted = JSON.parse(readFileSync(commandFile, 'utf8'));
    assert.deepEqual(emitted, commands);
    const reportFile = join(dir, 'report.json'), report = { result: 'running' };
    writeFileSync(reportFile, JSON.stringify(report));
    const outcome = recordFlowOutcome({ dir, recorded, commands: emitted, videoPath: null, videoReceipt: null,
      flowName: 'welcome', report, reportFile, timeline, commandReceipt: commandFile, failureDetail: () => {} });
    assert.equal(outcome.failureReason, null);
    assert.match(readFileSync(timeline, 'utf8'), /"type":"recorder-skipped","reason":"recording not requested"/);
    const noOp = await runRecordedFlow({ recordVideo: false,
      maestroCommand: process.execPath, maestroArgs: ['-e', 'process.exit(0)'],
      udid: 'fixture', video, recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env, dir, timeline,
      flow: 'assertVisible: Ready', diagnostic: async () => {} });
    rmSync(commandFile);
    assert.equal(existsSync(commandFile), false);
    const rejected = recordFlowOutcome({ dir, recorded: noOp, commands: existsSync(commandFile) ? JSON.parse(readFileSync(commandFile, 'utf8')) : null,
      videoPath: null, videoReceipt: null, flowName: 'welcome', report, reportFile, timeline,
      commandReceipt: existsSync(commandFile) ? commandFile : null, failureDetail: () => ({ noReceipt: true }) });
    assert.equal(rejected.failureReason, 'missing-or-empty-command-receipt');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pre-XCTest Maestro exit retains primary failure and records missing capture proof', async () => {
  const dir = temp(), timeline = join(dir, 'timeline.jsonl');
  try {
    const recorded = await runRecordedFlow({ recordVideo: false, maestroCommand: process.execPath,
      maestroArgs: ['-e', 'process.exit(1)'], udid: 'fixture', video: join(dir, 'video.mp4'),
      recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env, dir, timeline,
      flow: 'assertVisible: Ready', diagnostic: async () => {} });
    assert.equal(recorded.result.code, 1);
    applyCapturePolicy(recorded.result, { verified: false });
    const reportFile = join(dir, 'report.json'), report = { result: 'running' };
    writeFileSync(reportFile, JSON.stringify(report));
    const outcome = recordFlowOutcome({ dir, recorded, commands: null, videoPath: null, videoReceipt: null,
      flowName: 'welcome', report, reportFile, timeline, commandReceipt: null,
      failureDetail: () => ({ capturePolicyFailure: recorded.result.capturePolicyFailure }) });
    assert.equal(outcome.failureReason, 'maestro-exit');
    assert.match(JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8')).capturePolicyFailure, /launch receipt/);
    assert.match(JSON.parse(readFileSync(join(dir, 'timing-summary.json'), 'utf8')).capturePolicyFailure, /launch receipt/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('capture proof failure precedence preserves command and watchdog failures without allowing a pass', () => {
  const cases = [
    [{ code: 1, reason: null, error: 'driver exited' }, 'maestro-exit', 'driver exited'],
    [{ code: 1, reason: 'inactivity-deadline', error: 'quiet' }, 'inactivity-deadline', 'quiet'],
    [{ code: 0, reason: 'recorder-failure', error: 'recorder stopped' }, 'recorder-failure', 'recorder stopped'],
    [{ code: 0, reason: null, error: null }, 'xctest-capture-unverified', null],
  ];
  for (const [initial, expected, originalError] of cases) {
    const result = applyCapturePolicy({ ...initial }, { verified: false, error: 'invalid JSON' });
    assert.equal(flowFailureReason(result, null, { state: 'skipped' }), expected);
    assert.match(result.capturePolicyFailure, /invalid JSON/);
    if (originalError) assert.equal(result.error, originalError);
  }
  const verified = applyCapturePolicy({ code: 0, reason: null }, { verified: true });
  assert.equal(verified.capturePolicyFailure, undefined);
  assert.equal(verified.reason, null);
});

test('healthy long command with driver progress outlives the inactivity interval', async () => {
  const dir = temp();
  try {
    const script = "const fs=require('fs');const p=process.argv[1];const tick=setInterval(()=>fs.appendFileSync(p,'.'),70);setTimeout(()=>{clearInterval(tick);process.exit(0)},1150)";
    const timeline = join(dir, 'events.jsonl');
    const result = await runOwnedMaestro(process.execPath, ['-e', script, join(dir, 'maestro.log')],
      { cwd: dir, env: process.env, dir, timeline, flow: 'timeout: 300000\ndelay: 60000',
        diagnostic: () => { throw Error('unexpected watchdog'); }, pollMs: 20 });
    assert.equal(result.code, 0);
    assert.equal(result.reason, null);
    assert.ok(result.elapsedMs >= 1100);
    const start = readFileSync(timeline, 'utf8').trim().split('\n').map(line => JSON.parse(line)).find(entry => entry.type === 'maestro-start');
    assert.equal(start.inactivityDeadlineMs, 420000);
    assert.equal(start.deadlineMs, 1680000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Maestro start timeline failure reaps only its owned command and keeper', async () => {
  const dir = temp();
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let keeperPid = null, commandPid = null;
  try {
    const spawnImpl = (...args) => {
      const child = spawn(...args);
      keeperPid = child.pid;
      child.on('message', message => { if (message.type === 'command-start') commandPid = message.pid; });
      return child;
    };
    await assert.rejects(runOwnedMaestro(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: dir, env: process.env, dir, timeline: dir, flow: '', diagnostic: async () => {},
        quietMs: 60000, wallMs: 60000, pollMs: 20, spawnImpl }), /EISDIR/);
    assert.ok(keeperPid && commandPid);
    await assertProcessStopped(commandPid);
    await assertProcessStopped(keeperPid);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    for (const pid of [commandPid, keeperPid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('Maestro diagnostic timeline failure reaps its owned group and preserves callback error', async () => {
  const dir = temp(), timeline = join(dir, 'events.jsonl');
  let keeperPid = null, commandPid = null;
  try {
    const spawnImpl = (...args) => {
      const child = spawn(...args);
      keeperPid = child.pid;
      child.on('message', message => { if (message.type === 'command-start') commandPid = message.pid; });
      return child;
    };
    await assert.rejects(runOwnedMaestro(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: dir, env: process.env, dir, timeline, flow: '', spawnImpl,
        diagnostic: async () => { rmSync(timeline); mkdirSync(timeline); throw Error('capture failed'); },
        quietMs: 100, wallMs: 3000, pollMs: 20 }), /EISDIR/);
    assert.ok(keeperPid && commandPid);
    await assertProcessStopped(commandPid);
    await assertProcessStopped(keeperPid);
  } finally {
    for (const pid of [commandPid, keeperPid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Maestro escalation timeline failure reaps a TERM-resistant command', async () => {
  const dir = temp(), timeline = join(dir, 'events.jsonl');
  let keeperPid = null, commandPid = null;
  try {
    const spawnImpl = (...args) => {
      const child = spawn(...args);
      keeperPid = child.pid;
      child.on('message', message => { if (message.type === 'command-start') commandPid = message.pid; });
      return child;
    };
    const stubborn = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    await assert.rejects(runOwnedMaestro(process.execPath, ['-e', stubborn],
      { cwd: dir, env: process.env, dir, timeline, flow: '', spawnImpl,
        diagnostic: async () => { rmSync(timeline); mkdirSync(timeline); },
        quietMs: 100, wallMs: 3000, pollMs: 20, terminationGraceMs: 100 }), /EISDIR/);
    await assertProcessStopped(commandPid);
    await assertProcessStopped(keeperPid);
  } finally {
    for (const pid of [commandPid, keeperPid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Maestro end timeline failure leaves no owned keeper after command exit', async () => {
  const dir = temp(), timeline = join(dir, 'events.jsonl');
  let keeperPid = null, commandPid = null;
  try {
    const spawnImpl = (...args) => {
      const child = spawn(...args);
      keeperPid = child.pid;
      child.on('message', message => { if (message.type === 'command-start') commandPid = message.pid; });
      return child;
    };
    const script = "const fs=require('fs');const p=process.argv[1];const wait=()=>{if(!fs.existsSync(p))return setTimeout(wait,10);fs.rmSync(p);fs.mkdirSync(p);process.exit(0)};wait()";
    await assert.rejects(runOwnedMaestro(process.execPath, ['-e', script, timeline],
      { cwd: dir, env: process.env, dir, timeline, flow: '', spawnImpl, diagnostic: async () => {},
        quietMs: 3000, wallMs: 3000, pollMs: 20 }), /EISDIR/);
    assert.ok(keeperPid && commandPid);
    await assertProcessStopped(commandPid);
    await assertProcessStopped(keeperPid);
  } finally {
    for (const pid of [commandPid, keeperPid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recorded flow removes signal listeners after evidence write failure', async () => {
  const dir = temp();
  const intListeners = process.listenerCount('SIGINT'), termListeners = process.listenerCount('SIGTERM');
  try {
    await assert.rejects(runRecordedFlow({
      recorderCommand: process.execPath, recorderArgs: ['-e', 'setInterval(() => {}, 1000)'],
      maestroCommand: process.execPath, maestroArgs: ['-e', 'setInterval(() => {}, 1000)'],
      udid: 'test-device', video: join(dir, 'video.mp4'), recorderLog: join(dir, 'recorder.log'),
      cwd: dir, env: process.env, dir, timeline: dir, flow: '', diagnostic: async () => {},
    }), /EISDIR/);
    assert.equal(process.listenerCount('SIGINT'), intListeners);
    assert.equal(process.listenerCount('SIGTERM'), termListeners);
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

test('completed Maestro flow reaps a lingering owned driver without changing its passing result', async () => {
  const dir = temp(), pidFile = join(dir, 'descendant.pid'), timeline = join(dir, 'events.jsonl');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let descendantPid = null;
  try {
    const script = "const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));setTimeout(()=>process.exit(0),150)";
    const diagnostics = [];
    const result = await runOwnedMaestro(process.execPath, ['-e', script, pidFile],
      { cwd: dir, env: process.env, dir, timeline, flow: '', diagnostic: async reason => diagnostics.push(reason),
        quietMs: 3000, wallMs: 5000, pollMs: 20, terminationGraceMs: 500 });
    descendantPid = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(result.code, 0);
    assert.equal(result.reason, null);
    assert.deepEqual(diagnostics, ['owned-descendant-after-command-exit']);
    await assertProcessStopped(descendantPid);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    const events = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(events.some(item => item.type === 'maestro-descendant-cleanup' && item.outcome === 'terminated'));
  } finally {
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('completed Maestro flow fails if its owned driver resists bounded cleanup', async () => {
  const dir = temp(), pidFile = join(dir, 'descendant.pid'), readyFile = join(dir, 'ready'), timeline = join(dir, 'events.jsonl');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let descendantPid = null;
  try {
    const stubborn = "process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)";
    const script = `const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(stubborn)},process.argv[2]],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));const wait=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(wait);process.exit(0)}},10)`;
    const result = await runOwnedMaestro(process.execPath, ['-e', script, pidFile, readyFile],
      { cwd: dir, env: process.env, dir, timeline, flow: '', diagnostic: async () => {},
        quietMs: 3000, wallMs: 5000, pollMs: 20, terminationGraceMs: 100 });
    descendantPid = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(result.code, 0);
    assert.equal(result.reason, 'owned-descendant-after-command-exit');
    await assertProcessStopped(descendantPid);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    const events = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(events.some(item => item.type === 'maestro-descendant-cleanup' && item.outcome === 'SIGTERM-grace-expired'));
  } finally {
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('watchdog reaps a TERM-resistant descendant after Maestro parent exits', async () => {
  const dir = temp(), pidFile = join(dir, 'descendant.pid');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let descendantPid = null;
  try {
    const stubborn = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const script = `const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`;
    const result = await runOwnedMaestro(process.execPath, ['-e', script, pidFile],
      { cwd: dir, env: process.env, dir, timeline: join(dir, 'events.jsonl'), flow: '', diagnostic: async () => {},
        quietMs: 150, wallMs: 3000, pollMs: 20, terminationGraceMs: 100 });
    descendantPid = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(result.reason, 'inactivity-deadline');
    assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('unexpected keeper loss fails with diagnostics and never signals an ambiguous group', async () => {
  const dir = temp(), timeline = join(dir, 'events.jsonl');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let keeperPid = null, commandPid = null, diagnostics = 0;
  try {
    const running = runOwnedMaestro(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: dir, env: process.env, dir, timeline, flow: '', diagnostic: async () => { diagnostics++; },
        quietMs: 60000, wallMs: 60000, pollMs: 20 });
    const deadline = Date.now() + 3000;
    while (!existsSync(timeline) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(timeline));
    const start = JSON.parse(readFileSync(timeline, 'utf8').trim().split('\n')[0]);
    keeperPid = start.pid; commandPid = start.commandPid;
    process.kill(keeperPid, 'SIGKILL');
    const result = await running;
    assert.equal(result.reason, 'keeper-ownership-lost');
    assert.equal(diagnostics, 1);
    assert.doesNotThrow(() => process.kill(commandPid, 0));
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    if (commandPid) { try { process.kill(commandPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    if (keeperPid) { try { process.kill(keeperPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('keeper stays alive after runner disconnect until a TERM-resistant descendant is killed', async () => {
  const dir = temp(), pidFile = join(dir, 'disconnect-descendant.pid'), readyFile = join(dir, 'descendant-ready');
  const keeperPath = new URL('./owned-process-keeper.mjs', import.meta.url).pathname;
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let descendantPid = null;
  const stubborn = "process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)";
  const command = `const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(stubborn)},process.argv[2]],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`;
  const keeper = spawn(process.execPath, [keeperPath, process.execPath, '-e', command, pidFile, readyFile],
    { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('keeper did not start command')), 3000);
      keeper.on('message', message => { if (message.type === 'command-start') { clearTimeout(timer); resolve(); } });
    });
    const deadline = Date.now() + 3000;
    while ((!existsSync(pidFile) || !existsSync(readyFile)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(readyFile), 'TERM-resistant child installed its handler before disconnect');
    descendantPid = Number(readFileSync(pidFile, 'utf8'));
    keeper.disconnect();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('keeper disconnect cleanup exceeded 7 seconds')), 7000);
      keeper.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await assertProcessStopped(descendantPid);
    assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
  } finally {
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    try { process.kill(keeper.pid, 'SIGKILL'); } catch { /* fixture cleanup */ }
    sentinel.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
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
    assert.equal(result.endedBeforeStop, false);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally { unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); }
});

test('recorder keeps its real keeper open until a delayed exit receipt arrives', async () => {
  const dir = temp(), video = join(dir, 'video.mp4');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let releaseReceipt, receiptHeld, closeSent;
  const held = new Promise(resolve => { receiptHeld = resolve; });
  const closed = new Promise(resolve => { closeSent = resolve; });
  const delayedReceiptSpawn = (command, args, options) => {
    const keeper = spawn(command, args, options);
    const emit = keeper.emit.bind(keeper), send = keeper.send.bind(keeper);
    keeper.emit = function (name, ...values) {
      if (name === 'message' && values[0]?.type === 'command-exit') {
        releaseReceipt = () => emit(name, ...values);
        receiptHeld();
        return true;
      }
      return emit(name, ...values);
    };
    keeper.send = (message, ...values) => {
      if (message.type === 'close') closeSent();
      return send(message, ...values);
    };
    return keeper;
  };
  let recorder;
  try {
    const script = "process.on('SIGINT',()=>{require('fs').writeFileSync(process.argv[1],'proof');process.exit(0)});setInterval(()=>{},1000)";
    recorder = await startOwnedRecorder('test-device', video, join(dir, 'recorder.log'),
      { command: process.execPath, args: ['-e', script, video], spawnImpl: delayedReceiptSpawn });
    const stopping = stopOwnedRecorder(recorder, { killGraceMs: 500 });
    await held;
    const earlyClose = await Promise.race([closed.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
    assert.equal(earlyClose, false, 'keeper must retain IPC until the command receipt is delivered');
    releaseReceipt();
    const result = await stopping;
    assert.equal(result.code, 0);
    assert.equal(result.bytes, 5);
    await assertProcessStopped(recorder.pid);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    releaseReceipt?.();
    for (const pid of [recorder?.commandPid, recorder?.pid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder reports a missing exit receipt and reaps only its keeper', async () => {
  const dir = temp(), unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let recorder;
  try {
    const suppressReceipt = (command, args, options) => {
      const keeper = spawn(command, args, options), emit = keeper.emit.bind(keeper);
      keeper.emit = function (name, ...values) {
        if (name === 'message' && values[0]?.type === 'command-exit') return true;
        return emit(name, ...values);
      };
      return keeper;
    };
    const script = "process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)";
    recorder = await startOwnedRecorder('test-device', join(dir, 'video.mp4'), join(dir, 'recorder.log'),
      { command: process.execPath, args: ['-e', script], spawnImpl: suppressReceipt });
    await assert.rejects(stopOwnedRecorder(recorder, { killGraceMs: 150 }), /no exit receipt within 150 ms/);
    await assertProcessStopped(recorder.pid);
    await assertProcessStopped(recorder.commandPid);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    for (const pid of [recorder?.commandPid, recorder?.pid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('Maestro watchdog keeps its real keeper open until a delayed exit receipt arrives', async () => {
  const dir = temp(), unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let releaseReceipt, receiptHeld, closeSent;
  const held = new Promise(resolve => { receiptHeld = resolve; });
  const closed = new Promise(resolve => { closeSent = resolve; });
  const delayedReceiptSpawn = (command, args, options) => {
    const keeper = spawn(command, args, options), emit = keeper.emit.bind(keeper), send = keeper.send.bind(keeper);
    keeper.emit = function (name, ...values) {
      if (name === 'message' && values[0]?.type === 'command-exit') {
        releaseReceipt = () => emit(name, ...values);
        receiptHeld();
        return true;
      }
      return emit(name, ...values);
    };
    keeper.send = (message, ...values) => {
      if (message.type === 'close') closeSent();
      return send(message, ...values);
    };
    return keeper;
  };
  try {
    const script = "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)";
    const running = runOwnedMaestro(process.execPath, ['-e', script],
      { cwd: dir, env: process.env, dir, timeline: join(dir, 'events.jsonl'), flow: '', diagnostic: async () => {},
        quietMs: 120, wallMs: 1500, pollMs: 20, terminationGraceMs: 500, spawnImpl: delayedReceiptSpawn });
    await held;
    const earlyClose = await Promise.race([closed.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
    assert.equal(earlyClose, false, 'watchdog must retain IPC until the command receipt is delivered');
    releaseReceipt();
    const result = await running;
    assert.equal(result.reason, 'inactivity-deadline');
    assert.equal(result.code, 0);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    releaseReceipt?.();
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('successful Maestro keeps its keeper open until a delayed exit receipt arrives', async () => {
  const dir = temp();
  let releaseReceipt, receiptHeld, closeSent;
  const held = new Promise(resolve => { receiptHeld = resolve; });
  const closed = new Promise(resolve => { closeSent = resolve; });
  const delayedReceiptSpawn = (command, args, options) => {
    const keeper = spawn(command, args, options), emit = keeper.emit.bind(keeper), send = keeper.send.bind(keeper);
    keeper.emit = function (name, ...values) {
      if (name === 'message' && values[0]?.type === 'command-exit') {
        releaseReceipt = () => emit(name, ...values);
        receiptHeld();
        return true;
      }
      return emit(name, ...values);
    };
    keeper.send = (message, ...values) => {
      if (message.type === 'close') closeSent();
      return send(message, ...values);
    };
    return keeper;
  };
  let running;
  try {
    running = runOwnedMaestro(process.execPath, ['-e', 'process.exit(0)'],
      { cwd: dir, env: process.env, dir, timeline: join(dir, 'events.jsonl'), flow: '', diagnostic: async () => {},
        quietMs: 2000, wallMs: 5000, pollMs: 20, terminationGraceMs: 500, spawnImpl: delayedReceiptSpawn });
    await held;
    const earlyClose = await Promise.race([closed.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 150))]);
    assert.equal(earlyClose, false, 'successful command must retain IPC until the command receipt is delivered');
    releaseReceipt();
    const result = await running;
    assert.equal(result.reason, null);
    assert.equal(result.code, 0);
  } finally {
    releaseReceipt?.();
    await running?.catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const recorderExitCode of [0, 1]) test(`early recorder exit ${recorderExitCode} with partial video fails its still-running flow`, async () => {
  const dir = temp(), video = join(dir, 'video.mp4'), timeline = join(dir, 'timeline.jsonl');
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    const recorderScript = `require('fs').writeFileSync(process.argv[1],'partial');setTimeout(()=>process.exit(${recorderExitCode}),450)`;
    const maestroScript = 'setTimeout(()=>process.exit(0),2000)';
    const diagnostics = [];
    const { result, recorderResult } = await runRecordedFlow({
      recorderCommand: process.execPath, recorderArgs: ['-e', recorderScript, video],
      maestroCommand: process.execPath, maestroArgs: ['-e', maestroScript], udid: 'test-device', video,
      recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env, dir, timeline, flow: '',
      diagnostic: async reason => diagnostics.push(reason), quietMs: 3000, wallMs: 3000, pollMs: 20,
    });
    assert.equal(result.reason, 'recorder-ended-early');
    assert.ok(result.elapsedMs < 1800, 'early recorder exit should stop the owned flow promptly');
    assert.equal(recorderResult.state, 'stopped');
    assert.equal(recorderResult.code, recorderExitCode);
    assert.equal(recorderResult.endedBeforeStop, true);
    assert.equal(readFileSync(video, 'utf8'), 'partial');
    assert.deepEqual(diagnostics, ['recorder-ended-early']);
    const events = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.find(event => event.type === 'recorder-early-exit').code, recorderExitCode);
    await assertProcessStopped(events.find(event => event.type === 'maestro-start').pid);
    await assertProcessStopped(events.find(event => event.type === 'recorder-start').pid);
    assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
  } finally { sentinel.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); }
});

test('recorder completion during requested stop preserves a passing flow', async () => {
  const dir = temp(), video = join(dir, 'video.mp4'), timeline = join(dir, 'timeline.jsonl');
  try {
    const recorderScript = "process.on('SIGINT',()=>{require('fs').writeFileSync(process.argv[1],'complete');process.exit(0)});setInterval(()=>{},1000)";
    const maestroScript = 'setTimeout(()=>process.exit(0),100)';
    const { result, recorderResult, recorderStartedMs, recorderEndedMs } = await runRecordedFlow({
      recorderCommand: process.execPath, recorderArgs: ['-e', recorderScript, video],
      maestroCommand: process.execPath, maestroArgs: ['-e', maestroScript], udid: 'test-device', video,
      recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env, dir, timeline, flow: '',
      diagnostic: async () => {}, quietMs: 3000, wallMs: 3000, pollMs: 20,
    });
    assert.equal(result.reason, null);
    assert.equal(result.code, 0);
    assert.equal(recorderResult.code, 0);
    assert.equal(recorderResult.bytes, 8);
    assert.equal(recorderResult.endedBeforeStop, false);
    const events = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.some(event => event.type === 'recorder-early-exit'), false);
    assert.ok(events.findIndex(event => event.type === 'maestro-end') < events.findIndex(event => event.type === 'recorder-end'));
    assert.ok(recorderEndedMs >= recorderStartedMs);
    assert.equal(recorderResult.observedAtMs, recorderEndedMs);
    assert.ok(recorderEndedMs >= Date.parse(events.find(event => event.type === 'maestro-end').wall));
    assert.ok(recorderEndedMs <= Date.parse(events.find(event => event.type === 'recorder-end').wall));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recorder exit observed by keeper before stop fails even when IPC delivery follows stop request', async () => {
  const dir = temp(), video = join(dir, 'video.mp4'), marker = join(dir, 'recorder-exiting'), timeline = join(dir, 'timeline.jsonl');
  try {
    const delayedExitSpawnImpl = (command, args, options) => {
      const child = spawn(command, args, options);
      const emit = child.emit;
      let heldExit = null;
      child.emit = function (name, ...values) {
        const message = name === 'message' ? values[0] : null;
        if (message?.type === 'command-exit') { heldExit = values; return true; }
        if (message?.type === 'ack' && heldExit) {
          const exit = heldExit;
          heldExit = null;
          emit.call(child, 'message', ...exit);
        }
        return emit.call(this, name, ...values);
      };
      return child;
    };
    const recorderScript = "const fs=require('fs');fs.writeFileSync(process.argv[1],'partial');setTimeout(()=>{fs.writeFileSync(process.argv[2],'exiting');process.exit(0)},450)";
    const maestroScript = "const fs=require('fs');const wait=()=>fs.existsSync(process.argv[1])?setTimeout(()=>process.exit(0),180):setTimeout(wait,10);wait()";
    const diagnostics = [];
    const { result, recorderResult, recorderStartedMs, recorderEndedMs } = await runRecordedFlow({
      recorderCommand: process.execPath, recorderArgs: ['-e', recorderScript, video, marker], recorderSpawnImpl: delayedExitSpawnImpl,
      maestroCommand: process.execPath, maestroArgs: ['-e', maestroScript, marker], udid: 'test-device', video,
      recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env, dir, timeline, flow: '',
      diagnostic: async reason => diagnostics.push(reason), quietMs: 3000, wallMs: 3000, pollMs: 20,
    });
    assert.equal(result.reason, 'recorder-ended-early');
    assert.equal(recorderResult.code, 0);
    assert.equal(recorderResult.endedBeforeStop, true);
    assert.equal(readFileSync(video, 'utf8'), 'partial');
    assert.deepEqual(diagnostics, ['recorder-ended-early']);
    const events = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(recorderEndedMs >= recorderStartedMs);
    assert.ok(recorderEndedMs < Date.parse(events.find(event => event.type === 'maestro-end').wall), 'keeper exit observation precedes Maestro completion despite delayed IPC');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recorder exit inside startup wait retains partial proof and captures diagnostics', async () => {
  const dir = temp(), video = join(dir, 'video.mp4'), timeline = join(dir, 'timeline.jsonl');
  try {
    const recorderScript = "require('fs').writeFileSync(process.argv[1],'partial');setTimeout(()=>process.exit(0),40)";
    const diagnostics = [];
    const { result, recorderResult, recorderStartedMs, recorderEndedMs } = await runRecordedFlow({
      recorderCommand: process.execPath, recorderArgs: ['-e', recorderScript, video],
      maestroCommand: process.execPath, maestroArgs: ['-e', 'setTimeout(()=>process.exit(0),1000)'],
      udid: 'test-device', video, recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env,
      dir, timeline, flow: '', diagnostic: async reason => { diagnostics.push(reason); await new Promise(resolve => setTimeout(resolve, 200)); }, quietMs: 3000, wallMs: 3000, pollMs: 20,
    });
    assert.equal(result.reason, 'recorder-ended-early');
    assert.equal(recorderResult.code, 0);
    assert.equal(recorderResult.endedBeforeStop, true);
    assert.equal(readFileSync(video, 'utf8'), 'partial');
    assert.deepEqual(diagnostics, ['recorder-ended-early']);
    const events = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.some(event => event.type === 'maestro-start'), false);
    assert.ok(recorderEndedMs >= recorderStartedMs);
    assert.ok(recorderEndedMs <= Date.parse(events.find(event => event.type === 'recorder-early-exit').wall) + 50, 'startup diagnostic time is outside the recording interval');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recorder exit during watchdog diagnostics takes precedence and retains the watchdog reason', async () => {
  const dir = temp(), video = join(dir, 'video.mp4'), marker = join(dir, 'stop-recorder'), timeline = join(dir, 'timeline.jsonl');
  try {
    const recorderScript = "const fs=require('fs');fs.writeFileSync(process.argv[1],'partial');const wait=()=>fs.existsSync(process.argv[2])?process.exit(0):setTimeout(wait,10);wait()";
    const diagnostics = [];
    const recorded = await runRecordedFlow({
      recorderCommand: process.execPath, recorderArgs: ['-e', recorderScript, video, marker],
      maestroCommand: process.execPath, maestroArgs: ['-e', 'setInterval(()=>{},1000)'],
      udid: 'test-device', video, recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env,
      dir, timeline, flow: '', diagnostic: async reason => {
        diagnostics.push(reason);
        if (reason === 'inactivity-deadline') {
          writeFileSync(marker, 'exit');
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }, quietMs: 100, wallMs: 3000, pollMs: 20,
    });
    const { result, recorderResult, recorderStartedMs, recorderEndedMs } = recorded;
    assert.equal(recorderResult.endedBeforeStop, true);
    assert.equal(result.reason, 'recorder-ended-early');
    assert.equal(result.priorReason, 'inactivity-deadline');
    assert.deepEqual(diagnostics, ['inactivity-deadline', 'recorder-ended-early']);
    const failureReason = flowFailureReason(result, null, recorderResult, 'race-flow');
    const events = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    const observedEarlyExit = Date.parse(events.find(event => event.type === 'recorder-early-exit').wall);
    assert.ok(recorderEndedMs >= recorderStartedMs);
    assert.ok(recorderEndedMs <= observedEarlyExit + 50, 'watchdog diagnostic and cleanup time is outside the recording interval');
    const command = { command: { tapOnElementCommand: {} }, metadata: { status: 'COMPLETED', timestamp: recorderStartedMs + 20, duration: 10 } };
    saveRecordedFlowReceipts(dir, recorded, [command], { video, failureReason, failureDetail: { flow: 'race-flow', failureReason } });
    const savedTiming = JSON.parse(readFileSync(join(dir, 'timing-summary.json'), 'utf8'));
    const savedFailure = JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8'));
    assert.equal(savedTiming.failureReason, 'recorder-ended-early');
    assert.equal(savedFailure.failureReason, 'recorder-ended-early');
    assert.equal(savedTiming.priorReason, 'inactivity-deadline');
    assert.equal(savedFailure.priorReason, 'inactivity-deadline');
    assert.equal(savedTiming.recording.recorderEndedAt, new Date(recorderResult.observedAtMs).toISOString());
    assert.equal(savedTiming.recording.afterLastCommandMs, Math.max(0, recorderResult.observedAtMs - (recorderStartedMs + 30)));
    assert.equal(events.find(event => event.type === 'maestro-end').reason, 'inactivity-deadline');
    assert.ok(events.find(event => event.type === 'recorder-early-exit'));
    assert.equal(readFileSync(video, 'utf8'), 'partial');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('watchdog reason remains primary when recorder exits after the accepted stop', async () => {
  const dir = temp(), video = join(dir, 'video.mp4'), timeline = join(dir, 'timeline.jsonl');
  try {
    const recorderScript = "process.on('SIGINT',()=>{require('fs').writeFileSync(process.argv[1],'complete');process.exit(0)});setInterval(()=>{},1000)";
    const diagnostics = [];
    const { result, recorderResult } = await runRecordedFlow({
      recorderCommand: process.execPath, recorderArgs: ['-e', recorderScript, video],
      maestroCommand: process.execPath, maestroArgs: ['-e', 'setInterval(()=>{},1000)'],
      udid: 'test-device', video, recorderLog: join(dir, 'recorder.log'), cwd: dir, env: process.env,
      dir, timeline, flow: '', diagnostic: async reason => diagnostics.push(reason), quietMs: 100, wallMs: 3000, pollMs: 20,
    });
    assert.equal(result.reason, 'inactivity-deadline');
    assert.equal(result.priorReason, undefined);
    assert.equal(recorderResult.endedBeforeStop, false);
    assert.deepEqual(diagnostics, ['inactivity-deadline']);
    assert.equal(readFileSync(video, 'utf8'), 'complete');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recorder command startup failure is actionable and closes its keeper', async () => {
  const dir = temp();
  try {
    await assert.rejects(startOwnedRecorder('test-device', join(dir, 'video.mp4'), join(dir, 'recorder.log'),
      { command: join(dir, 'missing-recorder') }), /command did not start.*ENOENT/);
    assert.match(readFileSync(join(dir, 'recorder.log'), 'utf8'), /^$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recorder startup callback failure stops its owned group', async () => {
  const dir = temp();
  let keeperPid = null, commandPid = null;
  try {
    await assert.rejects(startOwnedRecorder('test-device', join(dir, 'video.mp4'), join(dir, 'recorder.log'), {
      command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'],
      onStart: owned => { keeperPid = owned.pid; commandPid = owned.commandPid; throw new Error('timeline unavailable'); },
    }), /timeline unavailable/);
    assert.ok(keeperPid);
    await assertProcessStopped(commandPid);
    await assertProcessStopped(keeperPid);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const failingWrite of [1, 2]) test(`recorder escalation log write ${failingWrite} failure reaps only its owned group`, async () => {
  const dir = temp(), log = join(dir, 'recorder.log'), badLog = join(dir, 'unwritable-log');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  let recorder;
  try {
    mkdirSync(badLog);
    const stubborn = "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    recorder = await startOwnedRecorder('test-device', join(dir, 'video.mp4'), log,
      { command: process.execPath, args: ['-e', stubborn] });
    let accesses = 0;
    Object.defineProperty(recorder, 'log', { get: () => ++accesses === failingWrite ? badLog : log });
    await assert.rejects(stopOwnedRecorder(recorder, { intGraceMs: 100, termGraceMs: 100, killGraceMs: 1000 }), /EISDIR/);
    await assertProcessStopped(recorder.commandPid);
    await assertProcessStopped(recorder.pid);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    for (const pid of [recorder?.commandPid, recorder?.pid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder stop acknowledgement failure reaps its owned group and retains the IPC error', async () => {
  const dir = temp(), unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  let recorder;
  try {
    recorder = await startOwnedRecorder('test-device', join(dir, 'video.mp4'), join(dir, 'recorder.log'),
      { command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] });
    const send = recorder.child.send.bind(recorder.child);
    recorder.child.send = message => {
      if (message.type === 'recorder-stop') throw Error('simulated keeper IPC write failure');
      return send(message);
    };
    await assert.rejects(stopOwnedRecorder(recorder, { termGraceMs: 100 }), /simulated keeper IPC write failure/);
    await assertProcessStopped(recorder.commandPid);
    await assertProcessStopped(recorder.pid);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    for (const pid of [recorder?.commandPid, recorder?.pid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder reaps its stubborn descendant when leader exits on SIGINT', async () => {
  const dir = temp(), pidFile = join(dir, 'recorder-descendant.pid');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let descendantPid = null;
  try {
    const stubborn = "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const script = `const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:'ignore'});fs.writeFileSync(process.argv[2],String(child.pid));process.on('SIGINT',()=>{fs.writeFileSync(process.argv[1],'proof');process.exit(0)});setInterval(()=>{},1000)`;
    const recorder = await startOwnedRecorder('test-device', join(dir, 'video.mp4'), join(dir, 'recorder.log'),
      { command: process.execPath, args: ['-e', script, join(dir, 'video.mp4'), pidFile] });
    descendantPid = Number(readFileSync(pidFile, 'utf8'));
    const result = await stopOwnedRecorder(recorder, { intGraceMs: 100, termGraceMs: 100 });
    assert.equal(result.state, 'stopped');
    assert.equal(result.bytes, 5);
    assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder stop accepts an already exited owned group', async () => {
  const dir = temp();
  try {
    const file = join(dir, 'video.mp4');
    const script = "setTimeout(()=>{require('fs').writeFileSync(process.argv[1],'proof');process.exit(0)},400)";
    const recorder = await startOwnedRecorder('test-device', file, join(dir, 'recorder.log'),
      { command: process.execPath, args: ['-e', script, file] });
    await recorder.completed;
    const result = await stopOwnedRecorder(recorder, { intGraceMs: 100, termGraceMs: 100 });
    assert.equal(result.state, 'stopped');
    assert.equal(result.bytes, 5);
    assert.throws(() => process.kill(recorder.pid, 0), { code: 'ESRCH' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recorder reaps a descendant created after startup when its parent exits before stop', async () => {
  const dir = temp(), pidFile = join(dir, 'late-descendant.pid');
  let descendantPid = null;
  try {
    const stubborn = "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const script = `const fs=require('fs'),cp=require('child_process');setTimeout(()=>{const child=cp.spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:'ignore'});fs.writeFileSync(process.argv[2],String(child.pid))},320);setTimeout(()=>{fs.writeFileSync(process.argv[1],'proof');process.exit(0)},600)`;
    const recorder = await startOwnedRecorder('test-device', join(dir, 'video.mp4'), join(dir, 'recorder.log'),
      { command: process.execPath, args: ['-e', script, join(dir, 'video.mp4'), pidFile] });
    assert.equal(recorder.commandResult, null);
    await recorder.completed;
    descendantPid = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(Number(execFileSync('ps', ['-p', String(descendantPid), '-o', 'pgid='], { encoding: 'utf8' }).trim()), recorder.pid);
    const result = await stopOwnedRecorder(recorder, { intGraceMs: 100, termGraceMs: 100 });
    assert.equal(result.state, 'stopped');
    assert.equal(result.bytes, 5);
    assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
  } finally {
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    rmSync(dir, { recursive: true, force: true });
  }
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

test('timing summary keeps every incomplete boundary and aggregate gap unknown', () => {
  const command = (timestamp, duration) => ({ command: { tapOnElementCommand: {} }, metadata: { status: 'COMPLETED', timestamp, duration } });
  const missing = { command: { retryCommand: { commands: [] } }, metadata: { status: 'COMPLETED' } };
  const complete = [command(1000, 500), command(2000, 500), command(46000, 1000)];
  const cases = [
    ['complete', complete, [500, 43500], [1000, 1000], true],
    ['missing-first', [missing, ...complete], [null, null], [null, null], false],
    ['missing-last', [...complete, missing], [null, null], [null, null], false],
    ['missing-middle', [complete[0], missing, ...complete.slice(1)], [null, null], [null, null], false],
    ['untimed-parent-later-gap', [complete[0], missing, complete[1], complete[2]], [null, null], [null, null], false],
    ['nested-overlap', [command(1000, 100000), command(11000, 1000), command(51000, 1000)], [0, 0], [1000, 0], false],
  ];
  for (const [name, raw, gaps, offsets, alert] of cases) {
    const output = summarizeFlowTiming(raw, { video: 'raw.mp4', recorderStartedMs: 0, recorderEndedMs: 48000 });
    assert.deepEqual(output.gaps.map(gap => gap.uncoveredMs), gaps, name);
    assert.deepEqual([output.recording.beforeFirstCommandMs, output.recording.afterLastCommandMs], offsets, name);
    assert.equal(output.gaps.some(gap => gap.investigationCandidate), alert, name);
    assert.equal(output.measuredIdleMs, null, name);
    assert.equal(output.recording.video, 'raw.mp4', name);
  }
  const noReceipt = summarizeFlowTiming(null, { video: 'raw.mp4', recorderStartedMs: 0, recorderEndedMs: 48000 });
  assert.equal(noReceipt.observation, 'missing-or-empty');
  assert.deepEqual([noReceipt.recording.beforeFirstCommandMs, noReceipt.recording.afterLastCommandMs], [null, null]);
  assert.equal(summarizeFlowTiming(complete).recording.recorderStartedAt, null);
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} reaps owned flow groups after diagnostics and preserves unrelated process`, async () => {
  const dir = temp();
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const fixture = join(dir, 'fixture.mjs');
  let descendantPid = null;
  const moduleUrl = new URL('./runner-controls.mjs', import.meta.url).href;
  const stubborn = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const maestroScript = `const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`;
  writeFileSync(fixture, `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordedFlow } from ${JSON.stringify(moduleUrl)};
const dir = process.argv[2];
const recorderScript = "process.on('SIGINT',()=>{require('fs').writeFileSync(process.argv[1],'video');process.exit(0)});setInterval(()=>{},1000)";
const result = await runRecordedFlow({ recorderCommand: process.execPath, recorderArgs: ['-e', recorderScript, join(dir,'video.mp4')],
  maestroCommand: process.execPath, maestroArgs: ['-e', ${JSON.stringify(maestroScript)}, join(dir,'descendant.pid')], udid: 'fixture', video: join(dir,'video.mp4'),
  recorderLog: join(dir,'recorder.log'), cwd: dir, env: process.env, dir, timeline: join(dir,'events.jsonl'), flow: '',
  diagnostic: async reason => writeFileSync(join(dir,'diagnostic.json'), JSON.stringify({reason})), quietMs: 60000, wallMs: 60000, pollMs: 20, terminationGraceMs: 100 });
writeFileSync(join(dir,'result.json'), JSON.stringify({ reason: result.result.reason, recorder: result.recorderResult }));`);
  const child = spawn(process.execPath, [fixture, dir], { stdio: 'ignore' });
  try {
    const timeline = join(dir, 'events.jsonl');
    const deadline = Date.now() + 5000;
    while ((!existsSync(timeline) || !readFileSync(timeline, 'utf8').includes('maestro-start')) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(timeline) && readFileSync(timeline, 'utf8').includes('maestro-start'), 'fixture reached active flow');
    child.kill(signal);
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('fixture cleanup exceeded 5 s')), 5000);
      child.once('exit', (code, exitSignal) => { clearTimeout(timer); resolve({ code, exitSignal }); });
    });
    assert.deepEqual(exit, { code: 0, exitSignal: null });
    const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
    assert.equal(result.reason, 'operator-interrupt');
    assert.equal(result.recorder.state, 'stopped');
    assert.equal(result.recorder.bytes, 5);
    assert.ok(existsSync(join(dir, 'diagnostic.json')));
    const lines = readFileSync(timeline, 'utf8').trim().split('\n').map(JSON.parse);
    const maestroPid = lines.find(line => line.type === 'maestro-start').pid;
    const recorderPid = lines.find(line => line.type === 'recorder-start').pid;
    descendantPid = Number(readFileSync(join(dir, 'descendant.pid'), 'utf8'));
    for (const pid of [maestroPid, descendantPid, recorderPid]) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
    assert.ok(lines.findIndex(line => line.type === 'maestro-end') < lines.findIndex(line => line.type === 'recorder-end'));
  } finally {
    child.kill('SIGKILL');
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch { /* fixture cleanup */ } }
    sentinel.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true });
  }
});

test('empty commands and abnormal recorder exit fail before walkthrough', () => {
  const result = { code: 0, reason: null };
  const command = [{ command: { assertConditionCommand: { condition: { visible: { textRegex: 'Ready' } } } }, metadata: { status: 'COMPLETED' } }];
  assert.equal(flowFailureReason(result, command, { state: 'stopped', code: 0, bytes: 5, endedBeforeStop: true }), 'recorder-ended-early');
  assert.equal(flowFailureReason({ code: null, reason: 'inactivity-deadline' }, [], { endedBeforeStop: true }), 'recorder-ended-early');
  assert.equal(flowFailureReason(result, [], { state: 'stopped', code: 0, bytes: 5 }), 'missing-or-empty-command-receipt');
  assert.equal(flowFailureReason(result, [], { state: 'stopped', code: 1, bytes: 5 }), 'recorder-failure');
  assert.equal(flowFailureReason(result, null, { state: 'stopped', code: 1, bytes: 5 }), 'recorder-failure');
  assert.equal(flowFailureReason(result, [], { state: 'stopped', code: 0, bytes: 0 }), 'recorder-failure');
  assert.equal(flowFailureReason(result, command, { state: 'stopped', code: 1, bytes: 5 }), 'recorder-failure');
  assert.equal(flowFailureReason(result, command, { state: 'stopped', code: 0, bytes: 5 }), null);
});

test('successful Maestro with undecodable recorder output records failure before walkthrough', () => {
  const dir = temp(), reportFile = join(dir, 'report.json'), timeline = join(dir, 'runner-timeline.jsonl');
  try {
    const video = join(dir, 'flow-untrimmed.mp4');
    const valid = readFileSync(new URL('../verify/fixtures/valid.mp4', import.meta.url));
    const atoms = [];
    for (let offset = 0; offset < valid.length;) {
      const size = valid.readUInt32BE(offset);
      assert.ok(size >= 8 && offset + size <= valid.length);
      if (valid.toString('ascii', offset + 4, offset + 8) !== 'mdat') atoms.push(valid.subarray(offset, offset + size));
      offset += size;
    }
    const broken = Buffer.concat(atoms);
    writeFileSync(video, broken);
    const report = { result: 'running', flows: [] };
    writeFileSync(reportFile, JSON.stringify(report));
    writeFileSync(timeline, '');
    const commands = [
      { command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile', name: 'welcome' } } }, metadata: { status: 'COMPLETED' } },
      { command: { assertConditionCommand: { condition: { visible: { textRegex: 'Ready' } } } }, metadata: { status: 'COMPLETED' } },
    ];
    const recorded = { result: { code: 0, reason: null, elapsedMs: 1000 }, recorderResult: { state: 'stopped', code: 0, bytes: broken.length },
      recorderStartedMs: Date.now() - 1000, recorderEndedMs: Date.now() };
    const outcome = recordFlowOutcome({ dir, recorded, commands, videoPath: video, videoReceipt: 'welcome/flow-untrimmed.mp4',
      flowName: 'welcome', report, reportFile, timeline, commandReceipt: 'welcome/commands.json',
      failureDetail: failureReason => ({ flow: 'welcome', failureReason, nearestScreenshot: null, nearestAX: null, networkTiming: null }) });
    assert.equal(outcome.failureReason, 'unplayable-video');
    assert.equal(JSON.parse(readFileSync(reportFile, 'utf8')).result, 'fail');
    assert.equal(JSON.parse(readFileSync(reportFile, 'utf8')).failedFlow, 'welcome');
    assert.equal(JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8')).failureReason, 'unplayable-video');
    assert.equal(JSON.parse(readFileSync(join(dir, 'timing-summary.json'), 'utf8')).failureReason, 'unplayable-video');
    assert.deepEqual(readFileSync(video), broken);
    assert.match(readFileSync(timeline, 'utf8'), /"outcome":"fail","failureReason":"unplayable-video"/);
    assert.doesNotMatch(readFileSync(timeline, 'utf8'), /awaiting-walkthrough/);
    const unplayableKey = recordedFlowFailureKey(null, 'welcome', outcome, recorded.result);
    const recorderFailure = { ...recorded, recorderResult: { ...recorded.recorderResult, code: 1 } };
    const recorderOutcome = recordFlowOutcome({ dir, recorded: recorderFailure, commands, videoPath: video,
      videoReceipt: 'welcome/flow-untrimmed.mp4', flowName: 'welcome', report, reportFile, timeline,
      commandReceipt: 'welcome/commands.json', failureDetail: failureReason => ({ flow: 'welcome', failureReason }) });
    const recorderKey = recordedFlowFailureKey(null, 'welcome', recorderOutcome, recorderFailure.result);
    assert.equal(recorderOutcome.failureReason, 'recorder-failure');
    assert.notEqual(recorderKey, unplayableKey);
    assert.equal(needsDiagnosis([{ key: recorderKey }, { key: unplayableKey }]), false);
    assert.equal(needsDiagnosis([{ key: unplayableKey }, { key: unplayableKey }]), true);
    const earlyRecorder = { ...recorded, recorderResult: { ...recorded.recorderResult, endedBeforeStop: true } };
    const partial = selector => [...commands, { command: { tapOnElement: { selector: { idRegex: selector } } },
      metadata: { status: 'FAILED', error: { message: 'Element not found' } } }];
    const firstPartial = partial('welcome-start'), secondPartial = partial('next-step');
    const recordEarly = partialCommands => recordFlowOutcome({ dir, recorded: earlyRecorder, commands: partialCommands,
      videoPath: video, videoReceipt: 'welcome/flow-untrimmed.mp4', flowName: 'welcome', report, reportFile, timeline,
      commandReceipt: 'welcome/commands.json', failureDetail: failureReason => ({ flow: 'welcome', failureReason }) });
    const firstEarly = recordEarly(firstPartial), secondEarly = recordEarly(secondPartial);
    assert.equal(firstEarly.failureReason, 'recorder-ended-early');
    assert.equal(secondEarly.failureReason, 'recorder-ended-early');
    const firstEarlyKey = recordedFlowFailureKey(nearestFailure(firstPartial), 'welcome', firstEarly, earlyRecorder.result);
    const secondEarlyKey = recordedFlowFailureKey(nearestFailure(secondPartial), 'welcome', secondEarly, earlyRecorder.result);
    assert.equal(firstEarlyKey, secondEarlyKey);
    assert.equal(needsDiagnosis([{ key: firstEarlyKey }, { key: secondEarlyKey }]), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two matching failures require a diagnosis checkpoint before another run', () => {
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'a' }]), true);
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'b' }]), false);
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'a', diagnosis: { file: 'review.json' } }]), false);
});

test('recording failures match only the same observed cause', () => {
  const result = { code: 0, reason: null };
  const summary = { observation: 'complete' };
  const recorderExit = recordedFlowFailureKey(null, 'welcome', { failureReason: 'recorder-failure', summary }, result);
  const corruptVideo = recordedFlowFailureKey(null, 'welcome', { failureReason: 'unplayable-video', summary }, result);
  assert.notEqual(recorderExit, corruptVideo);
  assert.equal(needsDiagnosis([{ key: recorderExit }, { key: corruptVideo }]), false);
  assert.equal(needsDiagnosis([{ key: corruptVideo }, { key: corruptVideo }]), true);
  const command = nearestFailure([{ command: { tapOnElement: { selector: { idRegex: 'welcome-start' } } },
    metadata: { status: 'FAILED', error: { message: 'Element not found' } } }]);
  const withRecorderExit = recordedFlowFailureKey(command, 'welcome', { failureReason: 'recorder-failure', summary }, result);
  const withCommandFailure = recordedFlowFailureKey(command, 'welcome', { failureReason: 'command-failure', summary }, result);
  assert.notEqual(withRecorderExit, withCommandFailure);
  const otherCommand = nearestFailure([{ command: { tapOnElement: { selector: { idRegex: 'next-step' } } },
    metadata: { status: 'FAILED', error: { message: 'Element not found' } } }]);
  const sameRecorderCause = recordedFlowFailureKey(otherCommand, 'welcome', { failureReason: 'recorder-failure', summary }, { code: 1, reason: 'maestro-exit' });
  assert.equal(withRecorderExit, sameRecorderCause);
  assert.equal(needsDiagnosis([{ key: withRecorderExit }, { key: sameRecorderCause }]), true);
  const differentCommand = recordedFlowFailureKey(otherCommand, 'welcome', { failureReason: 'command-failure', summary }, result);
  assert.notEqual(withCommandFailure, differentCommand);
});

test('production failure history distinguishes recording, command, flow, and receipt boundaries', () => {
  const root = temp();
  try {
    let count = 0;
    const make = ({ flow = 'welcome', receipt = 'complete', selector = 'welcome-start',
      cause = 'recorder-ended-early' }) => {
      const dir = join(root, String(++count)); mkdirSync(dir);
      const video = join(dir, 'flow-untrimmed.mp4'); writeFileSync(video, 'not playable');
      const reportFile = join(dir, 'report.json'), timeline = join(dir, 'runner-timeline.jsonl');
      const report = { result: 'running', flows: [] }; writeFileSync(reportFile, JSON.stringify(report));
      const config = { command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile', name: flow } } },
        metadata: { status: 'COMPLETED' } };
      const assertion = { command: { assertConditionCommand: { condition: { visible: { textRegex: 'Ready' } } } },
        metadata: { status: 'COMPLETED' } };
      const failed = { command: { tapOnElement: { selector: { idRegex: selector } } },
        metadata: { status: 'FAILED', error: { message: 'Element not found' } } };
      const commands = receipt === 'absent' ? null : receipt === 'partial' ? [config, failed]
        : receipt === 'failed-command' ? [config, assertion, failed] : [config, assertion];
      const recorderResult = { state: 'stopped', code: cause === 'recorder-failure' ? 1 : 0,
        bytes: 12, endedBeforeStop: cause === 'recorder-ended-early' };
      const result = { code: cause === 'maestro-exit' ? 1 : 0, reason: null, elapsedMs: 1000 };
      const outcome = recordFlowOutcome({ dir, recorded: { result, recorderResult,
        recorderStartedMs: Date.now() - 1000, recorderEndedMs: Date.now() }, commands,
        videoPath: video, videoReceipt: `${count}/flow-untrimmed.mp4`, flowName: flow,
        report, reportFile, timeline, commandReceipt: commands ? `${count}/commands.json` : null,
        failureDetail: failureReason => ({ flow, failureReason }) });
      assert.equal(outcome.failureReason, cause);
      return { failure: commands ? nearestFailure(commands) : null, flow, outcome, result, dir };
    };
    const cases = {
      earlyAbsent: make({ receipt: 'absent' }),
      earlyPartialA: make({ receipt: 'partial' }),
      earlyPartialB: make({ receipt: 'partial', selector: 'next-step' }),
      earlyComplete: make({ receipt: 'complete' }),
      earlyOtherFlow: make({ flow: 'signin', receipt: 'partial' }),
      recorderA: make({ cause: 'recorder-failure', receipt: 'partial' }),
      recorderB: make({ cause: 'recorder-failure', receipt: 'partial', selector: 'next-step' }),
      recorderComplete: make({ cause: 'recorder-failure', receipt: 'complete' }),
      recorderAbsent: make({ cause: 'recorder-failure', receipt: 'absent' }),
      unplayable: make({ cause: 'unplayable-video', receipt: 'complete' }),
      commandA: make({ cause: 'command-failure', receipt: 'failed-command' }),
      commandB: make({ cause: 'command-failure', receipt: 'failed-command', selector: 'next-step' }),
      maestroA: make({ cause: 'maestro-exit', receipt: 'failed-command' }),
      missing: make({ cause: 'missing-or-empty-command-receipt', receipt: 'absent' }),
    };
    const pairs = [
      ['earlyAbsent', 'earlyPartialA', true], ['earlyPartialA', 'earlyPartialB', true],
      ['earlyPartialA', 'earlyComplete', true], ['earlyPartialA', 'earlyOtherFlow', false],
      ['recorderA', 'recorderB', true], ['recorderA', 'recorderComplete', true],
      ['recorderAbsent', 'recorderA', true], ['recorderAbsent', 'recorderComplete', true],
      ['earlyPartialA', 'recorderA', false], ['recorderA', 'unplayable', false],
      ['unplayable', 'unplayable', true], ['recorderA', 'commandA', false],
      ['commandA', 'commandB', false], ['commandA', 'commandA', true],
      ['maestroA', 'commandA', false], ['earlyAbsent', 'missing', false],
      ['recorderAbsent', 'missing', false],
    ];
    for (const [firstName, secondName, expectedCheckpoint] of pairs) {
      const history = [];
      for (const name of [firstName, secondName]) {
        const item = cases[name];
        appendRecordedFlowFailure(history, item.failure, item.flow, item.outcome, item.result,
          { at: new Date().toISOString(), evidence: item.dir, head: 'fixture-head' });
      }
      const historyFile = join(root, 'native-failures.json');
      writeFileSync(historyFile, JSON.stringify(history));
      assert.equal(needsDiagnosis(JSON.parse(readFileSync(historyFile, 'utf8'))), expectedCheckpoint,
        `${firstName} then ${secondName}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('production outcomes preserve recorder precedence across command receipt and Maestro states', () => {
  const root = temp();
  try {
    const config = { command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile', name: 'welcome' } } },
      metadata: { status: 'COMPLETED' } };
    const assertion = { command: { assertConditionCommand: { condition: { visible: { textRegex: 'Ready' } } } },
      metadata: { status: 'COMPLETED' } };
    const failed = { command: { tapOnElement: { selector: { idRegex: 'welcome-start' } } },
      metadata: { status: 'FAILED', error: { message: 'Element not found' } } };
    const receipts = { absent: null, empty: [], partial: [config, failed], complete: [config, assertion] };
    const recorders = {
      healthy: { state: 'stopped', code: 0, bytes: 928 },
      exit: { state: 'stopped', code: 1, bytes: 928 },
      state: { state: 'running', code: 0, bytes: 928 },
      bytes: { state: 'stopped', code: 0, bytes: 0 },
    };
    const cases = new Map();
    let sequence = 0;
    for (const [receiptName, commands] of Object.entries(receipts)) {
      for (const [recorderName, recorderResult] of Object.entries(recorders)) {
        for (const maestroFailed of [false, true]) {
          const name = `${receiptName}-${recorderName}-${maestroFailed ? 'maestro-failed' : 'maestro-passed'}`;
          const dir = join(root, String(++sequence)); mkdirSync(dir);
          const video = join(dir, 'flow-untrimmed.mp4');
          writeFileSync(video, readFileSync(new URL('../verify/fixtures/valid.mp4', import.meta.url)));
          const commandReceipt = commands === null ? null : join(dir, 'commands.json');
          if (commandReceipt) writeFileSync(commandReceipt, JSON.stringify(commands));
          const reportFile = join(dir, 'report.json'), timeline = join(dir, 'runner-timeline.jsonl');
          const report = { result: 'running', flows: [] }; writeFileSync(reportFile, JSON.stringify(report));
          const result = { code: maestroFailed ? 1 : 0, reason: null, elapsedMs: 1000 };
          const outcome = recordFlowOutcome({ dir, recorded: { result, recorderResult,
            recorderStartedMs: Date.now() - 1000, recorderEndedMs: Date.now() }, commands,
            videoPath: video, videoReceipt: `${sequence}/flow-untrimmed.mp4`, flowName: 'welcome',
            report, reportFile, timeline, commandReceipt,
            failureDetail: failureReason => ({ flow: 'welcome', failureReason }) });
          const expectedReason = maestroFailed ? 'maestro-exit' : recorderName !== 'healthy' ? 'recorder-failure'
            : receiptName === 'absent' || receiptName === 'empty' ? 'missing-or-empty-command-receipt'
              : receiptName === 'partial' ? 'missing-or-failed-required-assertions' : null;
          assert.equal(outcome.failureReason, expectedReason, name);
          assert.deepEqual(commandReceipt ? JSON.parse(readFileSync(commandReceipt, 'utf8')) : null, commands, name);
          if (expectedReason) {
            assert.equal(JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8')).failureReason, expectedReason, name);
            const history = [];
            appendRecordedFlowFailure(history, commands ? nearestFailure(commands) : null, 'welcome', outcome, result,
              { evidence: dir, head: 'fixture-head' });
            cases.set(name, history[0]);
          }
        }
      }
    }
    const recorderAnchor = cases.get('absent-exit-maestro-passed');
    for (const receiptName of Object.keys(receipts)) {
      for (const recorderName of ['exit', 'state', 'bytes']) {
        const compared = cases.get(`${receiptName}-${recorderName}-maestro-passed`);
        assert.equal(needsDiagnosis([recorderAnchor, compared]), true, `${receiptName}-${recorderName}`);
      }
    }
    for (const different of ['absent-healthy-maestro-passed', 'partial-healthy-maestro-passed',
      'absent-exit-maestro-failed']) {
      assert.equal(needsDiagnosis([recorderAnchor, cases.get(different)]), false, different);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failure identity distinguishes flow and tap target while ignoring receipt timestamps', () => {
  const failure = (idRegex, timestamp, selector = { idRegex, optional: false }) => nearestFailure([{
    command: { tapOnElement: { selector } },
    metadata: { status: 'FAILED', timestamp, duration: 30000, error: { message: 'Element not found' } },
  }]);
  const first = matchingFailureKey(failure('welcome-start', 1000), 'cold-start-welcome');
  assert.equal(failure('welcome-start', 1000).expected, 'welcome-start');
  const same = matchingFailureKey(failure('welcome-start', 9000, { optional: false, idRegex: 'welcome-start' }), 'cold-start-welcome');
  const otherFlow = matchingFailureKey(failure('welcome-start', 1000), 'signin-options');
  const otherTarget = matchingFailureKey(failure('signin-email', 1000), 'cold-start-welcome');
  const noSelector = matchingFailureKey(failure(null, 1000, null), 'cold-start-welcome');
  assert.equal(first, same);
  assert.notEqual(first, otherFlow);
  assert.notEqual(first, otherTarget);
  assert.notEqual(first, noSelector);
  assert.match(noSelector, /selector:absent/);
  assert.equal(needsDiagnosis([{ key: first }, { key: same }]), true);
  assert.equal(needsDiagnosis([{ key: first }, { key: otherFlow }]), false);
  assert.equal(needsDiagnosis([{ key: first }, { key: otherTarget }]), false);
});

test('failure identity follows selectors inside retry commands', () => {
  const failure = (target, timestamp) => nearestFailure([{
    command: { retryCommand: { maxRetries: '2', commands: [
      { waitForAnimationToEndCommand: { timeout: 10000 } },
      { assertConditionCommand: { condition: { visible: { idRegex: target, optional: false } }, timeout: '30000' } },
    ] } },
    metadata: { status: 'FAILED', timestamp, error: { message: 'Element not found' } },
  }]);
  const first = matchingFailureKey(failure('welcome-start', 1000), 'onboarding-out-of-area');
  const repeat = matchingFailureKey(failure('welcome-start', 9000), 'onboarding-out-of-area');
  const other = matchingFailureKey(failure('waitlist-join', 1000), 'onboarding-out-of-area');
  assert.equal(first, repeat);
  assert.notEqual(first, other);
  assert.equal(needsDiagnosis([{ key: first }, { key: repeat }]), true);
  assert.equal(needsDiagnosis([{ key: first }, { key: other }]), false);
});

test('failure history key excludes target and error text retained in raw receipt', () => {
  const dir = temp(), error = 'Element welcome-start not found';
  const raw = [{
    command: { tapOnElement: { selector: { idRegex: 'welcome-start' } } },
    metadata: { status: 'FAILED', timestamp: 1000, error: { message: error } },
  }];
  try {
    const rawFile = join(dir, 'commands.json'), historyFile = join(dir, 'native-failures.json');
    writeFileSync(rawFile, JSON.stringify(raw));
    const failure = nearestFailure(raw), key = matchingFailureKey(failure, 'cold-start-welcome');
    writeFileSync(historyFile, JSON.stringify([{ key, flow: 'cold-start-welcome', evidence: rawFile, head: 'test' }]));
    assert.equal(failure.error, error);
    assert.doesNotMatch(readFileSync(historyFile, 'utf8'), /welcome-start|Element welcome-start not found/);
    assert.match(JSON.parse(key)[3], /^error:sha256:/);
    assert.deepEqual(JSON.parse(readFileSync(rawFile, 'utf8')), raw);
    const same = matchingFailureKey({ ...failure, error: '  Element  welcome-start\nnot found  ' }, 'cold-start-welcome');
    assert.equal(key, same);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
