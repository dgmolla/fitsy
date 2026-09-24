import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveFailureEvidence, flowFailureReason, requireMetro, runOwnedMaestro, startOwnedRecorder, stopOwnedRecorder, summarizeCommands, summarizeFlowTiming, nearestFailure, matchingFailureKey, needsDiagnosis } from './runner-controls.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'fitsy-runner-'));
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
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally { unrelated.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); }
});

test('recorder command startup failure is actionable and closes its keeper', async () => {
  const dir = temp();
  try {
    await assert.rejects(startOwnedRecorder('test-device', join(dir, 'video.mp4'), join(dir, 'recorder.log'),
      { command: join(dir, 'missing-recorder') }), /command did not start.*ENOENT/);
    assert.match(readFileSync(join(dir, 'recorder.log'), 'utf8'), /^$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
  assert.equal(flowFailureReason(result, [], { state: 'stopped', code: 0, bytes: 5 }), 'missing-or-empty-command-receipt');
  assert.equal(flowFailureReason(result, command, { state: 'stopped', code: 1, bytes: 5 }), 'recorder-failure');
  assert.equal(flowFailureReason(result, command, { state: 'stopped', code: 0, bytes: 5 }), null);
});

test('two matching failures require a diagnosis checkpoint before another run', () => {
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'a' }]), true);
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'b' }]), false);
  assert.equal(needsDiagnosis([{ key: 'a' }, { key: 'a', diagnosis: { file: 'review.json' } }]), false);
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
