import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, statfsSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { isPlayableVideo } from '../verify/product-flow.mjs';

const GiB = 1024 ** 3;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitOrTimeout(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}
export const clock = () => ({ wall: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString() });
export const event = (file, value) => appendFileSync(file, JSON.stringify({ ...clock(), ...value }) + '\n');
export function completeMaestroRun(reportFile, timeline, report) {
  // A finishable report must never get ahead of its final execution event.
  event(timeline, { type: 'run-end', outcome: 'awaiting-walkthrough' });
  report.result = 'awaiting-walkthrough';
  report.maestroFinishedAt = new Date().toISOString();
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
}
export function recordRunFailure(reportFile, timeline, error) {
  const evidenceErrors = [];
  try {
    if (existsSync(reportFile)) {
      const partial = JSON.parse(readFileSync(reportFile, 'utf8'));
      partial.result = 'fail';
      partial.infrastructureError = error.message;
      writeFileSync(reportFile, JSON.stringify(partial, null, 2) + '\n');
    }
  } catch (writeError) { evidenceErrors.push(`report: ${writeError.message}`); }
  try {
    if (existsSync(timeline)) event(timeline, { type: 'run-end', outcome: 'fail', error: error.message });
  } catch (writeError) { evidenceErrors.push(`timeline: ${writeError.message}`); }
  return evidenceErrors;
}
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
  if (value.selector) return value.selector.idRegex || value.selector.textRegex || JSON.stringify(value.selector);
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
    note: 'Recording boundaries are runner start and keeper-observed recorder exit, not exact first and last video frames. Missing exit observation remains unknown. Offsets do not establish visual or app idle without reviewing the video.' };
  return summary;
}
export function saveFlowOutcomeReceipts(dir, result, summary, failureDetail = null) {
  const priorReason = result.priorReason || null;
  const cleanupError = result.cleanupError || null;
  writeFileSync(join(dir, 'timing-summary.json'), JSON.stringify({ ...summary, priorReason, cleanupError,
    capturePolicyFailure: result.capturePolicyFailure || null }, null, 2) + '\n');
  if (failureDetail) writeFileSync(join(dir, 'failure.json'), JSON.stringify({ ...failureDetail, priorReason, cleanupError }, null, 2) + '\n');
}
export function applyCapturePolicy(result, { verified, error = null }) {
  if (verified) return result;
  result.capturePolicyFailure = `No valid scoped XCTest screenshots-only launch receipt${error ? ` (${error})` : ''}. Inspect Maestro driver and capture policy before retry.`;
  // An earlier command or watchdog failure is the primary diagnosis.
  // The absent receipt remains explicit evidence, and a successful command cannot pass it.
  if (result.code === 0 && !result.reason) {
    result.reason = 'xctest-capture-unverified';
    result.error = result.capturePolicyFailure;
  }
  return result;
}
export function saveRecordedFlowReceipts(dir, recorded, commands, { video, failureReason = null, failureDetail = null } = {}) {
  const { result, recorderStartedMs, recorderEndedMs } = recorded;
  const summary = summarizeFlowTiming(commands, { anchor: result.anchor, video, recorderStartedMs, recorderEndedMs });
  summary.failureReason = failureReason;
  saveFlowOutcomeReceipts(dir, result, summary, failureDetail);
  return summary;
}
export function nearestFailure(commands) {
  const failed = commands.filter(c => c.metadata?.status === 'FAILED').sort((a, b) => (b.metadata?.timestamp || 0) - (a.metadata?.timestamp || 0))[0];
  return failed ? { command: commandName(failed.command), expected: expected(failed.command),
    selectorIdentity: failureSelectorIdentity(failed.command),
    deadlineMs: Number(Object.values(failed.command)[0]?.timeout) || null, error: failed.metadata?.error?.message || null,
    hierarchy: failed.metadata?.error?.hierarchyRoot || null } : null;
}
function failureSelectorIdentity(command) {
  const normalize = item => Array.isArray(item) ? item.map(normalize) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'optional').sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, normalize(part)])) : item;
  const targets = [];
  const visit = current => {
    const [name, value] = Object.entries(current || {})[0] || [];
    if (!name) return;
    const selector = value?.selector ?? value?.condition ?? value?.point;
    if (selector != null) targets.push({ command: name, selector: normalize(selector) });
    for (const child of value?.commands || []) visit(child);
  };
  visit(command);
  return targets.length ? `selector:sha256:${createHash('sha256').update(JSON.stringify(targets)).digest('hex')}` : 'selector:absent';
}
export function matchingFailureKey(failure, flowName) {
  const errorIdentity = failure?.error == null ? 'error:absent'
    : `error:sha256:${createHash('sha256').update(String(failure.error).replace(/\s+/gu, ' ').trim()).digest('hex')}`;
  return failure && JSON.stringify([flowName || 'flow:absent', failure.command, failure.selectorIdentity || 'selector:absent', errorIdentity]);
}
export function recordedFlowFailureKey(failure, flowName, outcome, result) {
  if (['recorder-ended-early', 'recorder-failure', 'unplayable-video'].includes(outcome.failureReason))
    return JSON.stringify([flowName, outcome.failureReason]);
  const commandKey = matchingFailureKey(failure, flowName);
  return commandKey
    ? JSON.stringify([outcome.failureReason, commandKey])
    : JSON.stringify([flowName, outcome.failureReason, result.reason || result.code, outcome.summary.observation]);
}
export function appendRecordedFlowFailure(history, failure, flowName, outcome, result, details) {
  if (!outcome.failureReason) throw new Error('Cannot add a passing flow to failure history');
  const entry = { ...details, key: recordedFlowFailureKey(failure, flowName, outcome, result), flow: flowName };
  history.push(entry);
  return entry;
}
export function needsDiagnosis(history) {
  const last = history.slice(-2);
  return last.length === 2 && last[0].key === last[1].key && !last[1].diagnosis;
}
export function archiveFailureEvidence(history, from, to) {
  return history.map(entry => ({ ...entry, evidence: typeof entry.evidence === 'string' && entry.evidence.startsWith(`${from}/`)
    ? `${to}${entry.evidence.slice(from.length)}` : entry.evidence }));
}
export function flowFailureReason(result, commands, recorder, flowName = null) {
  if (recorder?.endedBeforeStop) return 'recorder-ended-early';
  if (result.code !== 0 || result.reason) return result.reason || 'maestro-exit';
  if (recorder?.state !== 'skipped' && (recorder?.state !== 'stopped' || recorder.code !== 0 || !recorder.bytes)) return 'recorder-failure';
  if (!Array.isArray(commands) || commands.length === 0) return 'missing-or-empty-command-receipt';
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
export function recordFlowOutcome({ dir, recorded, commands, videoPath, videoReceipt, flowName,
  report, reportFile, timeline, commandReceipt, failureDetail }) {
  const { result, recorderResult } = recorded;
  const failureReason = flowFailureReason(result, commands, recorderResult, flowName)
    || (recorderResult?.state === 'skipped' || isPlayableVideo(videoPath) ? null : 'unplayable-video');
  if (!failureReason) {
    saveRecordedFlowReceipts(dir, recorded, commands, { video: videoReceipt });
    return { failureReason: null };
  }
  const detail = failureDetail(failureReason);
  const summary = saveRecordedFlowReceipts(dir, recorded, commands,
    { video: videoReceipt, failureReason, failureDetail: detail });
  report.result = 'fail';
  report.failedFlow = flowName;
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  event(timeline, { type: 'flow-end', flow: flowName, outcome: 'fail', failureReason,
    priorReason: result.priorReason || null, elapsedMs: result.elapsedMs, commandReceipt });
  return { failureReason, summary };
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
    const startError = new Error(`Owned ${kind} command did not start within 3 seconds: ${owned.spawnError?.message || owned.commandResult?.error || 'keeper unavailable'}`);
    if (owned.pid && !owned.keeperResult) {
      try { await cleanupOwnedGroup(owned, 1000); }
      catch (cleanupError) { startError.cleanupError = cleanupError.message; }
    }
    throw startError;
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
  return answer;
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
async function requireCommandReceipt(owned, deadlineMs) {
  const result = await waitOrTimeout(owned.completed, deadlineMs);
  if (!result || result.ownershipLost)
    throw new Error(`Owned ${owned.kind} command ${owned.commandPid} has no exit receipt within ${deadlineMs} ms; inspect invocation diagnostics${owned.log ? ` and ${owned.log}` : ''}`);
  return result;
}
async function cleanupOwnedGroup(owned, termGraceMs = 5000, killGraceMs = 5000) {
  if (owned.keeperResult) return;
  let termError;
  try {
    await requestKeeper(owned, 'signal', 'SIGTERM');
    if (await waitForOtherMembers(owned, termGraceMs)) await closeKeeper(owned, killGraceMs);
    else await killOwnedGroup(owned, killGraceMs);
    return;
  } catch (error) { termError = error; }
  // A failed TERM acknowledgement or close must not abandon a live owned group.
  // The keeper alone may signal it; never address its former process group here.
  if (!owned.keeperResult) {
    try { await killOwnedGroup(owned, killGraceMs); return; }
    catch (killError) { throw new AggregateError([termError, killError], `Owned ${owned.kind} cleanup failed`); }
  }
  throw termError;
}
export function maxDeclaredWaitMs(flow) {
  const values = [...flow.matchAll(/(?:timeout|delay):\s*(\d+)/g)].map(match => Number(match[1]));
  return Math.max(0, ...values);
}
export function totalDeclaredWaitMs(flow) {
  return [...flow.matchAll(/(?:timeout|delay):\s*(\d+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
}
export async function startOwnedRecorder(udid, file, log, { command = 'xcrun', args = null, spawnImpl = spawn,
  onStart = null, onComplete = null } = {}) {
  const fd = openSync(log, 'w');
  let owned, startError;
  try { owned = await startOwnedGroup('recorder', command, args || ['simctl', 'io', udid, 'recordVideo', '--type=mp4', file],
    { stdio: ['ignore', fd, fd], spawnImpl }); }
  catch (error) { startError = error; }
  try { closeSync(fd); }
  catch (error) { if (startError) startError.closeError = error.message; else startError = error; }
  if (startError) {
    if (owned && !owned.keeperResult) {
      try { await cleanupOwnedGroup(owned); }
      catch (cleanupError) { startError.cleanupError = cleanupError.message; }
    }
    throw startError;
  }
  owned.file = file; owned.log = log;
  try { onStart?.(owned); }
  catch (error) {
    try { await stopOwnedRecorder(owned); }
    catch (cleanupError) { error.cleanupError = cleanupError.message; }
    throw error;
  }
  if (onComplete) owned.completed.then(exit => onComplete(exit, owned));
  await sleep(250);
  if (owned.commandResult || owned.keeperResult) {
    let recorderResult;
    try { recorderResult = await stopOwnedRecorder(owned); }
    catch (error) { recorderResult = { state: 'stop-error', bytes: null, error: error.message, cleanupError: error.cleanupError || null }; }
    const error = new Error(`Recorder exited before flow start or lost its keeper; inspect ${log}`);
    error.code = 'recorder-ended-early';
    error.recorderResult = recorderResult;
    throw error;
  }
  return owned;
}
export async function stopOwnedRecorder(recorder, { intGraceMs = 10000, termGraceMs = 5000, killGraceMs = 5000 } = {}) {
  if (!recorder) return { state: 'absent' };
  try {
    assertKeeper(recorder);
    const stopAcknowledgement = await requestKeeper(recorder, 'recorder-stop');
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
    // A vanished OS member does not prove its keeper has reported the exit.
    // Closing IPC first can turn a completed recording into a false failure.
    const result = await requireCommandReceipt(recorder, killGraceMs);
    if (!recorder.keeperResult) await closeKeeper(recorder, killGraceMs);
    return { state: 'stopped', code: result.code, signal: result.signal, endedBeforeStop: stopAcknowledgement.commandExitedBeforeStop,
      observedAtMs: Number.isFinite(result.observedAtMs) ? result.observedAtMs : null,
      observedMonotonicNs: result.observedMonotonicNs || null,
      file: recorder.file,
      bytes: existsSync(recorder.file) ? statSync(recorder.file).size : null };
  } catch (error) {
    if (!recorder.keeperResult) {
      try { await cleanupOwnedGroup(recorder, termGraceMs, killGraceMs); }
      catch (cleanupError) { error.cleanupError = cleanupError.message; }
    }
    throw error;
  }
}
function interruptionReason(signal) {
  return signal?.reason?.code === 'recorder-ended-early' ? 'recorder-ended-early' : 'operator-interrupt';
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
  try {
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
      reason = signal?.aborted ? interruptionReason(signal) : performance.now() - started > ceilingMs ? 'wall-deadline' : 'inactivity-deadline';
      await capture(reason, log);
      await requestKeeper(owned, 'signal', 'SIGTERM');
      if (!await waitForOtherMembers(owned, terminationGraceMs)) {
        event(timeline, { type: 'maestro-escalation', pid: ownedPid, outcome: 'SIGTERM-grace-expired', members: otherMembers(owned) });
        await killOwnedGroup(owned, 5000);
      } else {
        await requireCommandReceipt(owned, 5000);
        await closeKeeper(owned);
      }
      break;
    }
    if (owned.keeperResult && !reason) {
      reason = 'keeper-ownership-lost';
      await capture(reason, latestMaestroLog(dir));
    }
    if (!reason) {
      // The keeper's child exit event can precede OS reaping by a few ticks.
      // A completed Maestro command may leave its owned driver child behind.
      // Capture that state, bound cleanup, and preserve the command outcome if TERM reaps it.
      if (!await waitForOtherMembers(owned, 1000)) {
        const members = otherMembers(owned);
        await capture('owned-descendant-after-command-exit', latestMaestroLog(dir));
        event(timeline, { type: 'maestro-descendant-cleanup', pid: ownedPid, members,
          expected: 'owned descendants exit or respond to SIGTERM after Maestro command exit', deadlineMs: terminationGraceMs,
          outcome: 'started' });
        await requestKeeper(owned, 'signal', 'SIGTERM');
        if (!await waitForOtherMembers(owned, terminationGraceMs)) {
          reason = 'owned-descendant-after-command-exit';
          event(timeline, { type: 'maestro-descendant-cleanup', pid: ownedPid, members: otherMembers(owned),
            outcome: 'SIGTERM-grace-expired' });
          await killOwnedGroup(owned, 5000);
        } else {
          event(timeline, { type: 'maestro-descendant-cleanup', pid: ownedPid, members, outcome: 'terminated' });
          await closeKeeper(owned);
        }
      } else await closeKeeper(owned);
    }
    const result = await waitOrTimeout(owned.completed, 5000);
    if (!result) throw new Error(`Owned Maestro command ${owned.commandPid} did not provide an exit receipt`);
    if (signal?.aborted && !reason) {
      reason = interruptionReason(signal);
      await capture(reason, latestMaestroLog(dir));
    }
    event(timeline, { type: 'maestro-end', pid: ownedPid, outcome: reason || (result.code === 0 ? 'pass' : 'fail'), exitCode: result.code, signal: result.signal,
      elapsedMs: performance.now() - started, reason });
    return { ...result, reason, elapsedMs: performance.now() - started, anchor };
  } catch (error) {
    // Every callback and evidence write after acquisition can throw. Keep the
    // original failure while closing only the group whose keeper we still own.
    if (!owned.keeperResult) {
      try { await cleanupOwnedGroup(owned, terminationGraceMs); }
      catch (cleanupError) { error.cleanupError = cleanupError.message; }
    }
    throw error;
  }
}

export async function runRecordedFlow({ recorderCommand = 'xcrun', recorderArgs = null, recorderSpawnImpl,
  maestroCommand, maestroArgs, maestroSpawnImpl, udid, video, recorderLog, cwd, env, dir, timeline, flow, diagnostic,
  quietMs, wallMs, pollMs, terminationGraceMs, recordVideo = true }) {
  const interruption = new AbortController();
  const onInt = () => interruption.abort(new Error('SIGINT received during owned native flow'));
  const onTerm = () => interruption.abort(new Error('SIGTERM received during owned native flow'));
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  let recorder = null, recorderPid = null, recorderStartedMs = null, result, recorderResult;
  let recorderStopRequested = false, recorderEarlyExitLogged = false;
  const earlyExit = (exit, source, owned) => {
    if (recorderEarlyExitLogged) return;
    recorderEarlyExitLogged = true;
    const error = new Error('Owned recorder exited before its flow ended; inspect recorder log and partial video');
    error.code = 'recorder-ended-early';
    try {
      event(timeline, { type: 'recorder-early-exit', pid: owned?.pid || recorderPid, code: exit?.code ?? null,
        signal: exit?.signal ?? null, ownershipLost: exit?.ownershipLost || false, source,
        outcome: 'fail', expected: 'recorder remains active until flow ends and stop is accepted' });
    } catch (timelineError) { error.timelineError = timelineError.message; }
    interruption.abort(error);
  };
  try {
    if (recordVideo) recorder = await startOwnedRecorder(udid, video, recorderLog,
      { command: recorderCommand, args: recorderArgs, spawnImpl: recorderSpawnImpl,
        onStart: owned => { recorderPid = owned.pid; recorderStartedMs = Date.now(); event(timeline, { type: 'recorder-start', pid: owned.pid, video }); },
        onComplete: (exit, owned) => { if (!recorderStopRequested) earlyExit(exit, 'completion-before-stop', owned); } });
    else event(timeline, { type: 'recorder-skipped', reason: 'recording not requested' });
    if (interruption.signal.aborted) throw interruption.signal.reason;
    result = await runOwnedMaestro(maestroCommand, maestroArgs, { cwd, env, dir, timeline, flow, diagnostic,
      signal: interruption.signal, quietMs, wallMs, pollMs, terminationGraceMs, spawnImpl: maestroSpawnImpl });
  } catch (error) {
    if (error.code === 'recorder-ended-early') {
      recorderResult = error.recorderResult;
      if (!recorderEarlyExitLogged) earlyExit(recorderResult, 'startup-before-stop', null);
      try { await diagnostic('recorder-ended-early', { pid: recorderPid, commandPid: null, log: null, elapsedMs: null, members: null }); }
      catch (diagnosticError) { event(timeline, { type: 'diagnostic-error', pid: recorderPid, error: diagnosticError.message }); }
    }
    result = { code: null, reason: interruption.signal.aborted ? interruptionReason(interruption.signal) : error.code === 'recorder-ended-early' ? 'recorder-ended-early' : 'runner-error',
      error: error.message, cleanupError: error.cleanupError || null, elapsedMs: null, anchor: clock() };
  } finally {
    try {
      recorderStopRequested = true;
      if (!recorderResult && recordVideo) {
        try { recorderResult = await stopOwnedRecorder(recorder); }
        catch (error) { recorderResult = { state: 'stop-error', bytes: null, error: error.message, cleanupError: error.cleanupError || null }; }
      }
      if (!recordVideo) recorderResult = { state: 'skipped', bytes: 0 };
      if (recorderResult?.endedBeforeStop) {
        earlyExit(recorderResult, 'keeper-stop-ack', recorder);
        if (result.reason !== 'recorder-ended-early') {
          if (result.reason) result.priorReason = result.reason;
          result.reason = 'recorder-ended-early';
          try { await diagnostic(result.reason, { pid: recorderPid, commandPid: null, log: latestMaestroLog(dir),
            elapsedMs: result.elapsedMs, members: null }); }
          catch (error) { event(timeline, { type: 'diagnostic-error', pid: recorderPid, error: error.message }); }
        }
      }
      event(timeline, { type: 'recorder-end', pid: recorderPid, ...recorderResult });
    } finally {
      process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
    }
  }
  if (interruption.signal.aborted && !result.reason) result.reason = interruptionReason(interruption.signal);
  return { result, recorderResult, recorderStartedMs,
    recorderEndedMs: Number.isFinite(recorderResult?.observedAtMs) ? recorderResult.observedAtMs : null };
}
