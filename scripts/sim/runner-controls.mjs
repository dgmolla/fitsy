import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, statSync, statfsSync, openSync, closeSync } from 'node:fs';
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
  let coverageEndMs = ordered[0].endMs;
  const gaps = ordered.slice(1).map((row, index) => {
    const before = ordered[index];
    const adjacentStartGapMs = row.startMs - before.startMs;
    const uncoveredMs = coverageEndMs === null ? null : Math.max(0, row.startMs - coverageEndMs);
    const overlaps = coverageEndMs !== null && row.startMs < coverageEndMs;
    coverageEndMs = coverageEndMs === null || row.endMs === null ? null : Math.max(coverageEndMs, row.endMs);
    return { afterIndex: before.index, beforeIndex: row.index, adjacentStartGapMs, precedingDurationMs: before.durationMs,
      uncoveredMs, overlaps, investigationCandidate: uncoveredMs !== null && uncoveredMs >= gapMs };
  });
  return { observation: ordered.length === rows.length ? 'complete-timestamps' : 'partial-timestamps', commands: rows, gaps,
    measuredIdleMs: null, note: 'Uncovered command intervals are unobserved time, not measured app or recording idle. Overlaps are not additive.' };
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
export function maxDeclaredWaitMs(flow) {
  const values = [...flow.matchAll(/(?:timeout|delay):\s*(\d+)/g)].map(match => Number(match[1]));
  return Math.max(0, ...values);
}
export function totalDeclaredWaitMs(flow) {
  return [...flow.matchAll(/(?:timeout|delay):\s*(\d+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
}
export async function startOwnedRecorder(udid, file, log, { command = 'xcrun', args = null, spawnImpl = spawn } = {}) {
  const fd = openSync(log, 'w');
  let child;
  try { child = spawnImpl(command, args || ['simctl', 'io', udid, 'recordVideo', '--type=mp4', file],
    { detached: true, stdio: ['ignore', fd, fd] }); }
  finally { closeSync(fd); }
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const completed = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  await sleep(250);
  if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Recorder exited before flow start; inspect ${log}`);
  return { pid: child.pid, child, completed, file };
}
export async function stopOwnedRecorder(recorder) {
  if (!recorder) return { state: 'absent' };
  if (recorder.child.exitCode === null && recorder.child.signalCode === null) {
    try { process.kill(-recorder.pid, 'SIGINT'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  let result = await waitOrTimeout(recorder.completed, 10000);
  if (!result) {
    try { process.kill(-recorder.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    result = await waitOrTimeout(recorder.completed, 5000);
  }
  if (!result) {
    try { process.kill(-recorder.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    result = await waitOrTimeout(recorder.completed, 5000);
  }
  if (!result) throw new Error(`Owned recorder ${recorder.pid} did not stop; inspect before cleanup`);
  return { state: 'stopped', ...result, file: recorder.file, bytes: existsSync(recorder.file) ? statSync(recorder.file).size : null };
}
export async function runOwnedMaestro(command, args, { cwd, env, dir, timeline, flow, diagnostic, quietMs, wallMs, spawnImpl = spawn, pollMs = 1000 }) {
  const inactivityMs = quietMs ?? Math.max(180000, maxDeclaredWaitMs(flow) + 120000);
  // The wall limit includes all declared waits plus 10 minutes of driver overhead.
  // The 15 minute floor exceeds the observed 271 s healthy flow by over 3x.
  const ceilingMs = wallMs ?? Math.max(900000, totalDeclaredWaitMs(flow) * 3 + 600000);
  const anchor = clock(), started = performance.now();
  const child = spawnImpl(command, args, { cwd, env, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
  const ownedPid = child.pid;
  event(timeline, { type: 'maestro-start', pid: ownedPid, command: 'test', deadlineMs: ceilingMs, inactivityDeadlineMs: inactivityMs, expected: 'flow completes with all required commands' });
  let lastActivity = performance.now(), lastLogSize = -1, reason = null;
  const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  let settled = false, result;
  completed.then(value => { settled = true; result = value; }, error => { settled = true; result = { code: null, error: error.message }; });
  while (!settled) {
    await sleep(pollMs);
    const log = latestMaestroLog(dir);
    if (log) { try { const size = statSync(log).size; if (size !== lastLogSize) { lastLogSize = size; lastActivity = performance.now(); } } catch { /* a rotating log is not evidence of a hang */ } }
    if (performance.now() - started <= ceilingMs && performance.now() - lastActivity <= inactivityMs) continue;
    reason = performance.now() - started > ceilingMs ? 'wall-deadline' : 'inactivity-deadline';
    try { await diagnostic(reason, { pid: ownedPid, log, elapsedMs: performance.now() - started }); }
    catch (error) { event(timeline, { type: 'diagnostic-error', pid: ownedPid, error: error.message }); }
    // Only the process group created for this invocation is eligible.
    if (ownedPid && child.pid === ownedPid && !settled) {
      try { process.kill(-ownedPid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await waitOrTimeout(completed, 5000);
      if (!settled) {
        try { process.kill(-ownedPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        if (!await waitOrTimeout(completed, 5000)) throw new Error(`Owned Maestro process group ${ownedPid} did not exit after SIGKILL; inspect diagnostics`);
      }
    }
    break;
  }
  result = await completed.catch(error => ({ code: null, error: error.message }));
  event(timeline, { type: 'maestro-end', pid: ownedPid, outcome: reason || (result.code === 0 ? 'pass' : 'fail'), exitCode: result.code, signal: result.signal,
    elapsedMs: performance.now() - started, reason });
  return { ...result, reason, elapsedMs: performance.now() - started, anchor };
}
