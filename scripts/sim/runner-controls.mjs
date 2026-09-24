import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, statSync, statfsSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const GiB = 1024 ** 3;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitOrTimeout(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}
export const clock = () => ({ wall: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString() });
export const event = (file, value) => appendFileSync(file, JSON.stringify({ ...clock(), ...value }) + '\n');
export function admitDisk(path, phase, requiredGiB = 8) {
  const disk = statfsSync(path);
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  if (freeBytes < requiredGiB * GiB) throw new Error(`${phase} needs ${requiredGiB} GiB free on ${path}; ${Math.floor(freeBytes / GiB * 10) / 10} GiB available. Free owned disposable build data at an idle boundary, then retry.`);
  return { freeBytes, requiredBytes: requiredGiB * GiB };
}
export async function requireMetro(metro, { processIdentity, sourceHash, configHash, route }) {
  if (!metro || processIdentity(metro.pid) !== metro.processIdentity) throw new Error('Required owned Metro is absent or its PID changed. Start a fresh canonical product-flow run.');
  if (metro.nativeSourceHash !== sourceHash || metro.configHash !== configHash) throw new Error('Metro source/configuration differs from the installed app. Rebuild and start a fresh owned Metro.');
  for (const path of route ? ['/status', route] : ['/status']) {
    let response;
    try { response = await fetch(`http://127.0.0.1:${metro.port}${path}`, { signal: AbortSignal.timeout(path === '/status' ? 1500 : 30000) }); }
    catch { throw new Error(`Required Metro on port ${metro.port} is unreachable. Start the owned server and verify /status before Maestro.`); }
    if (!response.ok || (path === '/status' && await response.text() !== 'packager-status:running')) throw new Error(`Required Metro on port ${metro.port} is not ready (${path}: HTTP ${response.status}). Inspect metro.log before Maestro.`);
    if (path !== '/status') await response.arrayBuffer();
  }
}
const commandName = command => Object.keys(command || {})[0] || 'unknown';
function expected(command) {
  const value = Object.values(command || {})[0] || {};
  if (value.commands) return value.commands.map(item => expected(item)).filter(Boolean).join('; ') || null;
  const condition = value.condition || value.visible || value;
  if (condition.visible) return condition.visible.idRegex || condition.visible.textRegex || JSON.stringify(condition.visible);
  if (condition.notVisible) return `not visible: ${JSON.stringify(condition.notVisible)}`;
  return value.timeout ? commandName(command) : null;
}
export function summarizeCommands(commands, { gapMs = 30000, anchor = null } = {}) {
  if (!Array.isArray(commands) || !commands.length) return { observation: 'missing-or-empty', commands: [], gaps: [], measuredIdleMs: null };
  const rows = commands.map((entry, index) => {
    const value = Object.values(entry.command || {})[0] || {};
    const startMs = entry.metadata?.timestamp == null ? NaN : Number(entry.metadata.timestamp);
    const durationMs = entry.metadata?.duration == null ? NaN : Number(entry.metadata.duration);
    const timeoutMs = Number(value.timeout);
    const nestedTimeoutMs = value.commands?.reduce((sum, item) => sum + (Number(Object.values(item)[0]?.timeout) || 0), 0) || 0;
    const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : nestedTimeoutMs ? nestedTimeoutMs * (Number(value.maxRetries || 0) + 1) : null;
    const monotonicNs = anchor && Number.isFinite(startMs) ? (BigInt(anchor.monotonicNs) + BigInt(Math.round(startMs - Date.parse(anchor.wall))) * 1000000n).toString() : null;
    return { index, command: commandName(entry.command), start: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
      startMs: Number.isFinite(startMs) ? startMs : null, monotonicNs, monotonicSource: monotonicNs ? 'estimated from runner wall/monotonic anchor' : 'unavailable',
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      endMs: Number.isFinite(startMs) && Number.isFinite(durationMs) ? startMs + durationMs : null,
      expected: expected(entry.command), deadlineMs,
      outcome: entry.metadata?.status || 'missing', retryAttempts: Number.isInteger(entry.metadata?.retryAttempt) ? entry.metadata.retryAttempt : null,
      retryLimit: entry.command?.retryCommand?.maxRetries ?? null,
      error: entry.metadata?.error?.message || null };
  });
  const ordered = rows.filter(row => row.startMs !== null).sort((a, b) => a.startMs - b.startMs);
  if (!ordered.length) return { observation: 'no-timestamps', commands: rows, gaps: [], measuredIdleMs: null,
    note: 'Command timing is unavailable. No app or recording idle was measured.' };
  const timingComplete = rows.every(row => row.startMs !== null && row.endMs !== null);
  let coverageEndMs = ordered[0].endMs;
  const gaps = ordered.slice(1).map((row, index) => {
    const before = ordered[index];
    const adjacentStartGapMs = row.startMs - before.startMs;
    const uncoveredMs = !timingComplete || coverageEndMs === null || before.index >= row.index ? null : Math.max(0, row.startMs - coverageEndMs);
    const overlaps = coverageEndMs !== null && row.startMs < coverageEndMs;
    coverageEndMs = coverageEndMs === null || row.endMs === null ? null : Math.max(coverageEndMs, row.endMs);
    return { afterIndex: before.index, beforeIndex: row.index, adjacentStartGapMs, precedingDurationMs: before.durationMs,
      uncoveredMs, overlaps, investigationCandidate: uncoveredMs !== null && uncoveredMs >= gapMs };
  });
  return { observation: timingComplete ? 'complete-timestamps' : 'partial-timestamps', commands: rows, gaps,
    measuredIdleMs: null, note: 'Uncovered command intervals are unobserved time, not measured app or recording idle. Overlaps are not additive.' };
}
export function recordingOffsets(commands, recorderStartedMs, recorderEndedMs) {
  if (!commands.length || !Number.isFinite(recorderStartedMs) || !Number.isFinite(recorderEndedMs) ||
    commands.some(command => command.startMs === null || command.endMs === null))
    return { beforeFirstCommandMs: null, afterLastCommandMs: null };
  return { beforeFirstCommandMs: Math.max(0, Math.min(...commands.map(command => command.startMs)) - recorderStartedMs),
    afterLastCommandMs: Math.max(0, recorderEndedMs - Math.max(...commands.map(command => command.endMs))) };
}
export function summarizeFlowTiming(commands, { anchor = null, video = null, recorderStartedMs = null, recorderEndedMs = null } = {}) {
  const summary = summarizeCommands(commands, { anchor });
  summary.recording = { video, recorderStartedAt: recorderStartedMs === null ? null : new Date(recorderStartedMs).toISOString(),
    recorderEndedAt: recorderEndedMs === null ? null : new Date(recorderEndedMs).toISOString(),
    ...recordingOffsets(summary.commands, recorderStartedMs, recorderEndedMs),
    note: 'Recording boundaries include driver startup and shutdown. They do not establish visual or app idle without reviewing the video.' };
  return summary;
}
export function nearestFailure(commands) {
  const failed = commands.filter(c => c.metadata?.status === 'FAILED').sort((a, b) => (b.metadata?.timestamp || 0) - (a.metadata?.timestamp || 0))[0];
  return failed ? { command: commandName(failed.command), expected: expected(failed.command),
    deadlineMs: Number(Object.values(failed.command)[0]?.timeout) || null, error: failed.metadata?.error?.message || null,
    hierarchy: failed.metadata?.error?.hierarchyRoot || null } : null;
}
export function matchingFailureKey(failure) { return failure && JSON.stringify([failure.command, failure.expected, failure.error]); }
export function needsDiagnosis(history) {
  const last = history.slice(-2);
  return last.length === 2 && last[0].key === last[1].key && !last[1].diagnosis;
}
export function archiveFailureEvidence(history, from, to) {
  return history.map(entry => ({ ...entry, evidence: typeof entry.evidence === 'string' && entry.evidence.startsWith(`${from}/`)
    ? `${to}${entry.evidence.slice(from.length)}` : entry.evidence }));
}
export function flowFailureReason(result, commands, recorder, flowName = null) {
  if (result.code !== 0 || result.reason) return result.reason || 'maestro-exit';
  if (!Array.isArray(commands) || commands.length === 0) return 'missing-or-empty-command-receipt';
  if (recorder.state !== 'stopped' || recorder.code !== 0 || !recorder.bytes) return 'recorder-failure';
  if (flowName) {
    const applied = commands.find(c => c.command?.applyConfigurationCommand)?.command.applyConfigurationCommand.config;
    if (applied?.appId !== 'com.fitsy.mobile' || (applied.name && applied.name !== flowName)) return 'wrong-app-or-flow-receipt';
    const assertions = commands.filter(c => c.command?.assertConditionCommand && !c.command.assertConditionCommand.optional);
    if (!assertions.length || assertions.some(c => c.metadata?.status !== 'COMPLETED')) return 'missing-or-failed-required-assertions';
  }
  if (commands.some(c => c.metadata?.status === 'FAILED' ||
    (c.metadata?.status !== 'COMPLETED' && !Object.values(c.command || {}).some(v => v?.optional === true)))) return 'command-failure';
  return null;
}
export function latestMaestroLog(dir) {
  if (!existsSync(dir)) return null;
  const found = [];
  const walk = path => {
    let entries;
    try { entries = readdirSync(path); } catch { return; }
    for (const name of entries) {
      const file = join(path, name);
      let stat;
      try { stat = statSync(file); } catch { continue; }
      if (stat.isDirectory()) walk(file);
      else if (name === 'maestro.log') found.push({ file, modified: stat.mtimeMs });
    }
  };
  walk(dir);
  return found.sort((a, b) => b.modified - a.modified)[0]?.file || null;
}
function groupMembers(pgid) {
  const members = new Map();
  for (const line of execFileSync('ps', ['-A', '-o', 'pid=,pgid=,lstart='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (match && Number(match[2]) === pgid) members.set(Number(match[1]), match[3]);
  }
  return members;
}
const keeperPath = fileURLToPath(new URL('./owned-process-keeper.mjs', import.meta.url));
const otherMembers = owned => [...groupMembers(owned.pid).keys()].filter(pid => pid !== owned.pid);
function assertKeeper(owned) {
  if (owned.keeperResult || owned.child.exitCode !== null || owned.child.signalCode !== null)
    throw new Error(`Owned ${owned.kind} keeper ${owned.pid} exited unexpectedly; ownership lost. Inspect invocation diagnostics without signaling its former group.`);
}
async function startOwnedGroup(kind, command, args, { cwd, env, stdio, spawnImpl = spawn }) {
  const child = spawnImpl(process.execPath, [keeperPath, command, ...args],
    { cwd, env, detached: true, stdio: [...stdio, 'ipc'] });
  const owned = { kind, child, pid: child.pid, commandPid: null, commandResult: null, keeperResult: null, nextId: 0, pending: new Map() };
  let startResolve;
  const started = new Promise(resolve => { startResolve = resolve; });
  let commandResolve;
  owned.completed = new Promise(resolve => { commandResolve = resolve; });
  owned.keeperCompleted = new Promise(resolve => {
    child.once('exit', (code, signal) => {
      owned.keeperResult = { code, signal };
      for (const pending of owned.pending.values()) pending({ error: 'keeper exited before acknowledgement' });
      owned.pending.clear();
      if (!owned.commandResult) { owned.commandResult = { code: null, signal, error: 'keeper exited before command receipt', ownershipLost: true }; commandResolve(owned.commandResult); }
      startResolve(); resolve(owned.keeperResult);
    });
  });
  child.on('error', error => {
    owned.spawnError = error;
    startResolve();
  });
  child.on('message', message => {
    if (message.type === 'command-start') { owned.commandPid = message.pid; startResolve(); }
    if (message.type === 'command-exit' && !owned.commandResult) { owned.commandResult = message; commandResolve(message); startResolve(); }
    if (message.type === 'ack') { const pending = owned.pending.get(message.id); if (pending) { owned.pending.delete(message.id); pending(message); } }
  });
  await waitOrTimeout(started, 3000);
  if (!owned.commandPid || owned.spawnError || owned.keeperResult) {
    if (owned.pid && !owned.keeperResult) {
      try {
        await requestKeeper(owned, 'signal', 'SIGTERM');
        if (await waitForOtherMembers(owned, 1000)) await closeKeeper(owned);
        else await killOwnedGroup(owned, 5000);
      } catch { /* retain the actionable command-start error */ }
    }
    throw new Error(`Owned ${kind} command did not start within 3 seconds: ${owned.spawnError?.message || owned.commandResult?.error || 'keeper unavailable'}`);
  }
  return owned;
}
async function requestKeeper(owned, type, signal = null, timeoutMs = 1000) {
  assertKeeper(owned);
  const id = ++owned.nextId;
  const acknowledgement = new Promise(resolve => owned.pending.set(id, resolve));
  try { owned.child.send({ type, signal, id }); }
  catch (error) { owned.pending.delete(id); throw new Error(`Owned ${owned.kind} keeper IPC failed: ${error.message}`); }
  if (signal === 'SIGKILL') return;
  const answer = await waitOrTimeout(acknowledgement, timeoutMs);
  owned.pending.delete(id);
  if (!answer || answer.error) throw new Error(`Owned ${owned.kind} keeper did not acknowledge ${type}${signal ? ` ${signal}` : ''}: ${answer?.error || '1 second deadline'}`);
}
async function waitForOtherMembers(owned, ms) {
  const deadline = performance.now() + ms;
  while (true) {
    assertKeeper(owned);
    const members = otherMembers(owned);
    if (!members.length) return true;
    if (performance.now() >= deadline) return false;
    await sleep(Math.min(50, Math.max(1, deadline - performance.now())));
  }
}
async function killOwnedGroup(owned, graceMs) {
  const before = groupMembers(owned.pid);
  await requestKeeper(owned, 'signal', 'SIGKILL');
  if (!await waitOrTimeout(owned.keeperCompleted, graceMs))
    throw new Error(`Owned ${owned.kind} keeper ${owned.pid} did not exit after SIGKILL`);
  const deadline = performance.now() + graceMs;
  while (performance.now() < deadline) {
    const after = groupMembers(owned.pid);
    if (![...before].some(([pid, started]) => after.get(pid) === started)) return;
    await sleep(50);
  }
  throw new Error(`Owned ${owned.kind} group ${owned.pid} retained a member after SIGKILL; inspect diagnostics`);
}
async function closeKeeper(owned, graceMs = 5000) {
  const deadline = performance.now() + graceMs;
  let lastError = null;
  while (performance.now() < deadline) {
    assertKeeper(owned);
    if (!otherMembers(owned).length) {
      try { await requestKeeper(owned, 'close'); lastError = null; break; }
      catch (error) {
        if (!error.message.includes('group still contains')) throw error;
        lastError = error;
      }
    }
    await sleep(50);
  }
  if (lastError || performance.now() >= deadline)
    throw new Error(`Owned ${owned.kind} group ${owned.pid} still has descendants after close grace: ${lastError?.message || otherMembers(owned).join(',')}`);
  if (!await waitOrTimeout(owned.keeperCompleted, graceMs))
    throw new Error(`Owned ${owned.kind} keeper ${owned.pid} did not exit after close`);
}
export function maxDeclaredWaitMs(flow) {
  const values = [...flow.matchAll(/(?:timeout|delay):\s*(\d+)/g)].map(match => Number(match[1]));
  return Math.max(0, ...values);
}
export function totalDeclaredWaitMs(flow) {
  return [...flow.matchAll(/(?:timeout|delay):\s*(\d+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
}
export async function startOwnedRecorder(udid, file, log, { command = 'xcrun', args = null, spawnImpl = spawn } = {}) {
  const fd = openSync(log, 'w');
  let owned;
  try { owned = await startOwnedGroup('recorder', command, args || ['simctl', 'io', udid, 'recordVideo', '--type=mp4', file],
    { stdio: ['ignore', fd, fd], spawnImpl }); }
  finally { closeSync(fd); }
  owned.file = file; owned.log = log;
  await sleep(250);
  if (owned.commandResult || owned.keeperResult) {
    try { await stopOwnedRecorder(owned); } catch { /* preserve startup failure */ }
    throw new Error(`Recorder exited before flow start or lost its keeper; inspect ${log}`);
  }
  return owned;
}
export async function stopOwnedRecorder(recorder, { intGraceMs = 10000, termGraceMs = 5000, killGraceMs = 5000 } = {}) {
  if (!recorder) return { state: 'absent' };
  assertKeeper(recorder);
  if (otherMembers(recorder).length) {
    await requestKeeper(recorder, 'signal', 'SIGINT');
    if (!await waitForOtherMembers(recorder, intGraceMs)) {
      appendFileSync(recorder.log, `Recorder group ${recorder.pid} exceeded SIGINT grace; owned members: ${otherMembers(recorder).join(',')}\n`);
      await requestKeeper(recorder, 'signal', 'SIGTERM');
      if (!await waitForOtherMembers(recorder, termGraceMs)) {
        appendFileSync(recorder.log, `Recorder group ${recorder.pid} exceeded SIGTERM grace; owned members: ${otherMembers(recorder).join(',')}\n`);
        await killOwnedGroup(recorder, killGraceMs);
      }
    }
  }
  if (!recorder.keeperResult) await closeKeeper(recorder, killGraceMs);
  const result = await waitOrTimeout(recorder.completed, killGraceMs);
  if (!result) throw new Error(`Owned recorder command ${recorder.commandPid} has no exit receipt; inspect ${recorder.log}`);
  return { state: 'stopped', code: result.code, signal: result.signal, file: recorder.file,
    bytes: existsSync(recorder.file) ? statSync(recorder.file).size : null };
}
export async function runOwnedMaestro(command, args, { cwd, env, dir, timeline, flow, diagnostic, signal, quietMs, wallMs,
  spawnImpl = spawn, pollMs = 1000, terminationGraceMs = 5000 }) {
  const inactivityMs = quietMs ?? Math.max(180000, maxDeclaredWaitMs(flow) + 120000);
  // The wall limit includes all declared waits plus 10 minutes of driver overhead.
  // The 15 minute floor exceeds the observed 271 s healthy flow by over 3x.
  const ceilingMs = wallMs ?? Math.max(900000, totalDeclaredWaitMs(flow) * 3 + 600000);
  const anchor = clock(), started = performance.now();
  const owned = await startOwnedGroup('Maestro', command, args,
    { cwd, env, stdio: ['ignore', 'inherit', 'inherit'], spawnImpl });
  const ownedPid = owned.pid;
  event(timeline, { type: 'maestro-start', pid: ownedPid, commandPid: owned.commandPid, command: 'test', deadlineMs: ceilingMs,
    inactivityDeadlineMs: inactivityMs, expected: 'flow completes with all required commands' });
  let lastActivity = performance.now(), lastLogSize = -1, reason = null;
  const capture = async (failure, log) => {
    try { await diagnostic(failure, { pid: ownedPid, commandPid: owned.commandPid, log, elapsedMs: performance.now() - started,
      members: owned.keeperResult ? null : otherMembers(owned) }); }
    catch (error) { event(timeline, { type: 'diagnostic-error', pid: ownedPid, error: error.message }); }
  };
  while (!owned.commandResult && !owned.keeperResult) {
    await sleep(pollMs);
    const log = latestMaestroLog(dir);
    if (log) { try { const size = statSync(log).size; if (size !== lastLogSize) { lastLogSize = size; lastActivity = performance.now(); } } catch { /* a rotating log is not evidence of a hang */ } }
    if (owned.commandResult || owned.keeperResult) break;
    if (!signal?.aborted && performance.now() - started <= ceilingMs && performance.now() - lastActivity <= inactivityMs) continue;
    reason = signal?.aborted ? 'operator-interrupt' : performance.now() - started > ceilingMs ? 'wall-deadline' : 'inactivity-deadline';
    await capture(reason, log);
    await requestKeeper(owned, 'signal', 'SIGTERM');
    if (!await waitForOtherMembers(owned, terminationGraceMs)) {
      event(timeline, { type: 'maestro-escalation', pid: ownedPid, outcome: 'SIGTERM-grace-expired', members: otherMembers(owned) });
      await killOwnedGroup(owned, 5000);
    } else await closeKeeper(owned);
    break;
  }
  if (owned.keeperResult && !reason) {
    reason = 'keeper-ownership-lost';
    await capture(reason, latestMaestroLog(dir));
  }
  if (!reason) {
    // The keeper's child exit event can precede OS reaping by a few ticks.
    // A live descendant after that bounded reap interval is a flow failure.
    if (!await waitForOtherMembers(owned, 1000)) {
      reason = 'owned-descendant-after-command-exit';
      await capture(reason, latestMaestroLog(dir));
      await requestKeeper(owned, 'signal', 'SIGTERM');
      if (!await waitForOtherMembers(owned, terminationGraceMs)) {
        await killOwnedGroup(owned, 5000);
      } else await closeKeeper(owned);
    } else await closeKeeper(owned);
  }
  const result = await waitOrTimeout(owned.completed, 5000);
  if (!result) throw new Error(`Owned Maestro command ${owned.commandPid} did not provide an exit receipt`);
  if (signal?.aborted && !reason) reason = 'operator-interrupt';
  event(timeline, { type: 'maestro-end', pid: ownedPid, outcome: reason || (result.code === 0 ? 'pass' : 'fail'), exitCode: result.code, signal: result.signal,
    elapsedMs: performance.now() - started, reason });
  return { ...result, reason, elapsedMs: performance.now() - started, anchor };
}

export async function runRecordedFlow({ recorderCommand = 'xcrun', recorderArgs = null, recorderSpawnImpl,
  maestroCommand, maestroArgs, maestroSpawnImpl, udid, video, recorderLog, cwd, env, dir, timeline, flow, diagnostic,
  quietMs, wallMs, pollMs, terminationGraceMs }) {
  const interruption = new AbortController();
  const onInt = () => interruption.abort(new Error('SIGINT received during owned native flow'));
  const onTerm = () => interruption.abort(new Error('SIGTERM received during owned native flow'));
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  let recorder = null, recorderStartedMs = null, result, recorderResult;
  try {
    recorder = await startOwnedRecorder(udid, video, recorderLog,
      { command: recorderCommand, args: recorderArgs, spawnImpl: recorderSpawnImpl });
    recorderStartedMs = Date.now();
    event(timeline, { type: 'recorder-start', pid: recorder.pid, video });
    if (interruption.signal.aborted) throw interruption.signal.reason;
    result = await runOwnedMaestro(maestroCommand, maestroArgs, { cwd, env, dir, timeline, flow, diagnostic,
      signal: interruption.signal, quietMs, wallMs, pollMs, terminationGraceMs, spawnImpl: maestroSpawnImpl });
  } catch (error) {
    result = { code: null, reason: interruption.signal.aborted ? 'operator-interrupt' : 'runner-error',
      error: error.message, elapsedMs: null, anchor: clock() };
  } finally {
    try { recorderResult = await stopOwnedRecorder(recorder); }
    catch (error) { recorderResult = { state: 'stop-error', bytes: null, error: error.message }; }
    event(timeline, { type: 'recorder-end', pid: recorder?.pid || null, ...recorderResult });
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  }
  if (interruption.signal.aborted && !result.reason) result.reason = 'operator-interrupt';
  return { result, recorderResult, recorderStartedMs, recorderEndedMs: Date.now() };
}
