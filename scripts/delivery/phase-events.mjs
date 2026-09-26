#!/usr/bin/env node
// Local, append-only delivery timing evidence. Publishing is an explicit action.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const phases = new Set(['implementation', 'verification', 'unit', 'e2e', 'review', 'shipping']);
const statuses = new Set(['running', 'pass', 'fail', 'interrupted', 'skipped', 'cached']);
const token = /^[A-Za-z0-9._-]{1,100}$/;
const validToken = value => typeof value === 'string' && token.test(value);
const sha = /^[a-f0-9]{40}$/;
const repo = 'dgmolla/fitsy';
const fields = new Set(['event_id', 'run_id', 'issue', 'phase', 'attempt_id', 'started_at',
  'finished_at', 'duration_ms', 'status', 'source_sha', 'producer', 'round_id', 'lens', 'check']);
const directory = root => join(root, '.evidence/delivery');
const bindingFile = root => join(directory(root), 'binding.json');
const eventsFile = root => join(directory(root), 'events.jsonl');
const pendingFile = root => join(directory(root), 'publish-pending.json');
const publicationsFile = root => join(directory(root), 'publications.jsonl');
const lockDirectory = (root, kind = 'ledger') => join(directory(root), `${kind}.lock`);
const digest = events => createHash('sha256').update(JSON.stringify(events)).digest('hex');

function tryLock(root, kind = 'ledger') {
  mkdirSync(directory(root), { recursive: true, mode: 0o700 });
  try { mkdirSync(lockDirectory(root, kind), { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  const owner = { pid: process.pid, acquired_at: new Date().toISOString(), nonce: randomUUID() };
  const file = join(lockDirectory(root, kind), 'owner.json');
  try { writeFileSync(file, `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) { rmdirSync(lockDirectory(root, kind)); throw error; }
  return () => {
    const current = JSON.parse(readFileSync(file, 'utf8'));
    if (current.nonce !== owner.nonce) throw new Error('delivery lock ownership changed');
    unlinkSync(file);
    rmdirSync(lockDirectory(root, kind));
  };
}

function lockError(root, kind = 'ledger') {
  let owner = 'unknown';
  try { const value = JSON.parse(readFileSync(join(lockDirectory(root, kind), 'owner.json'), 'utf8'));
    owner = `pid ${value.pid} since ${value.acquired_at}`; } catch { /* Creation may still be in progress. */ }
  return new Error(`delivery ${kind} locked by ${owner}; confirm the owner is inactive, remove only ${lockDirectory(root, kind)}, then reconcile issue comments. Preserve publish-pending.json`);
}

function withSyncLock(root, action) {
  const deadline = Date.now() + 3000;
  let release;
  while (!(release = tryLock(root))) {
    if (Date.now() >= deadline) throw lockError(root);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  try { return action(); } finally { release(); }
}

async function withAsyncLock(root, action) {
  const deadline = Date.now() + 70000;
  let release;
  while (!(release = tryLock(root, 'publish'))) {
    if (Date.now() >= deadline) throw lockError(root, 'publish');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  try { return await action(); } finally { release(); }
}

function validTime(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      Object.keys(event).some(key => !fields.has(key))) throw new Error('invalid delivery event fields');
  if (![event.event_id, event.run_id, event.attempt_id].every(validToken) ||
      !Number.isSafeInteger(event.issue) || event.issue <= 0 || !phases.has(event.phase) ||
      !statuses.has(event.status) || !validTime(event.started_at) || !sha.test(event.source_sha) ||
      !validToken(event.producer) ||
      ['round_id', 'lens', 'check'].some(key => event[key] !== undefined && !validToken(event[key]))) {
    throw new Error('invalid delivery event');
  }
  if (event.status === 'running') {
    if (event.finished_at !== null || event.duration_ms !== null) throw new Error('running event has a finish');
  } else if (!validTime(event.finished_at) || !Number.isSafeInteger(event.duration_ms) ||
      event.duration_ms < 0 || Date.parse(event.finished_at) < Date.parse(event.started_at) ||
      Math.abs(event.duration_ms - (Date.parse(event.finished_at) - Date.parse(event.started_at))) > 1000 ||
      (event.status === 'cached' && event.duration_ms !== 0)) {
    throw new Error('invalid delivery event duration');
  }
  return event;
}

export function buildSummary(issue, runId, rows, updatedAt) {
  if (!Number.isSafeInteger(issue) || issue <= 0 || !validToken(runId) || !validTime(updatedAt)) {
    throw new Error('invalid delivery summary identity');
  }
  const byAttempt = new Map();
  const ids = new Set();
  for (const row of rows) {
    validateEvent(row);
    if (ids.has(row.event_id)) throw new Error('duplicate delivery event ID');
    ids.add(row.event_id);
    if (row.issue !== issue || row.run_id !== runId) continue;
    const previous = byAttempt.get(row.attempt_id);
    if (!previous && row.status !== 'running') throw new Error('delivery attempt has no start');
    if (previous && (previous.status !== 'running' || row.status === 'running' ||
        (row.status === 'cached' ? row.started_at !== row.finished_at : row.started_at !== previous.started_at) ||
        row.phase !== previous.phase ||
        row.producer !== previous.producer)) throw new Error('invalid delivery attempt transition');
    byAttempt.set(row.attempt_id, row);
  }
  const events = [...byAttempt.values()];
  if (events.some(event => Date.parse(event.finished_at ?? event.started_at) > Date.parse(updatedAt))) {
    throw new Error('delivery summary predates an event');
  }
  return { v: 1, issue, run_id: runId, updated_at: updatedAt, events };
}

export function readBinding(root = process.cwd()) {
  if (!existsSync(bindingFile(root))) return null;
  const value = JSON.parse(readFileSync(bindingFile(root), 'utf8'));
  if (!Number.isSafeInteger(value.issue) || value.issue <= 0 || !validToken(value.run_id)) {
    throw new Error('invalid delivery issue binding');
  }
  return value;
}

function bindUnlocked(root, issue, newRun = false) {
  if (!Number.isSafeInteger(issue) || issue <= 0) throw new Error('issue must be a positive integer');
  const prior = readBinding(root);
  if (prior && !newRun) {
    if (prior.issue !== issue) throw new Error('different issue requires bind --new-run');
    return prior;
  }
  if (prior && existsSync(lockDirectory(root, 'publish'))) throw lockError(root, 'publish');
  const rows = prior ? readRows(root) : [];
  if (prior && rows.some(row => row.run_id === prior.run_id && row.status === 'running' &&
      !rows.some(next => next.attempt_id === row.attempt_id && next.status !== 'running'))) {
    throw new Error('finish active delivery attempts before rebinding');
  }
  if (prior && existsSync(pendingFile(root))) throw new Error('reconcile pending delivery publication before rebinding');
  if (prior) {
    const events = buildSummary(prior.issue, prior.run_id, rows, new Date().toISOString()).events;
    const publication = existsSync(publicationsFile(root)) ? readFileSync(publicationsFile(root), 'utf8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line))
      .filter(row => row.run_id === prior.run_id && row.scope !== 'shard').at(-1) : null;
    if (events.length && publication?.digest !== digest(events)) {
      throw new Error('publish prior run events before rebinding');
    }
  }
  const value = { issue, run_id: randomUUID() };
  mkdirSync(directory(root), { recursive: true, mode: 0o700 });
  const temporary = `${bindingFile(root)}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporary, bindingFile(root));
  return value;
}

export function bind(root, issue, newRun = false) {
  return withSyncLock(root, () => bindUnlocked(root, issue, newRun));
}

export function readRows(root = process.cwd()) {
  if (!existsSync(eventsFile(root))) return [];
  return readFileSync(eventsFile(root), 'utf8').split('\n').filter(Boolean).map(line => validateEvent(JSON.parse(line)));
}

function append(root, row) {
  validateEvent(row);
  mkdirSync(directory(root), { recursive: true, mode: 0o700 });
  appendFileSync(eventsFile(root), `${JSON.stringify(row)}\n`, { mode: 0o600, flag: 'a' });
  return row;
}

let warned = false;
function context(root) {
  const binding = readBinding(root);
  if (!binding && !warned) {
    process.stderr.write('delivery telemetry: no issue binding; run phase-events.mjs bind --issue N\n');
    warned = true;
  }
  return binding;
}

function head(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

export function start(root, phase, producer, extras = {}, now = new Date().toISOString()) {
  return withSyncLock(root, () => {
    const binding = context(root);
    if (!binding) return null;
    const row = { event_id: randomUUID(), run_id: binding.run_id, issue: binding.issue, phase,
      attempt_id: randomUUID(), started_at: now, finished_at: null, duration_ms: null,
      status: 'running', source_sha: head(root), producer, ...extras };
    append(root, row);
    return row.attempt_id;
  });
}

export function finish(root, attemptId, status, now = new Date().toISOString(), sourceSha) {
  return withSyncLock(root, () => {
    const binding = context(root);
    if (!binding) return null;
    const rows = readRows(root).filter(row => row.run_id === binding.run_id && row.attempt_id === attemptId);
    if (rows.length !== 1 || rows[0].status !== 'running' || status === 'running' || !statuses.has(status)) {
      throw new Error('delivery attempt is missing, finished, or has invalid status');
    }
    const started = rows[0];
    const duration = status === 'cached' ? 0 : Date.parse(now) - Date.parse(started.started_at);
    return append(root, { ...started, event_id: randomUUID(), started_at: status === 'cached' ? now : started.started_at, finished_at: now,
      duration_ms: duration, status, source_sha: sourceSha ?? head(root) });
  });
}

export function closeOnSignals(close) {
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    try { close(); }
    finally {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    }
  });
}

function commentBody(payload) {
  const body = `<!-- fitsy-delivery:v1:${payload.run_id} -->\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  if (Buffer.byteLength(body) > 60000) throw new Error('delivery comment exceeds 60000 bytes; split the run');
  return body;
}

function existingPayload(body, marker) {
  if (!body.startsWith(marker)) throw new Error('delivery comment marker is not first');
  const match = /^<!-- fitsy-delivery:v1:[A-Za-z0-9._-]+ -->\n\n```json\n([^\n]+)\n```$/.exec(body);
  if (!match) throw new Error('invalid existing delivery comment');
  return JSON.parse(match[1]);
}

function recordPublication(root, payload, id, scope = 'shard') {
  appendFileSync(publicationsFile(root), `${JSON.stringify({ run_id: payload.run_id,
    digest: digest(payload.events), comment_id: id, scope, at: new Date().toISOString() })}\n`,
  { mode: 0o600, flag: 'a' });
}

function transportShards(summary) {
  const shards = [];
  for (let offset = 0; offset < Math.max(1, summary.events.length); offset += 50) {
    const runId = offset ? `${summary.run_id}.p${offset / 50 + 1}` : summary.run_id;
    if (!validToken(runId)) throw new Error('delivery shard ID exceeds token limit; bind a shorter new run');
    shards.push({ ...summary, run_id: runId,
      events: summary.events.slice(offset, offset + 50).map(event => ({ ...event, run_id: runId })) });
  }
  return shards;
}

async function publishUnlocked(root, api, binding, logical) {
  const shards = transportShards(logical);
  const bodies = shards.map(commentBody);
  let pending = existsSync(pendingFile(root)) ? JSON.parse(readFileSync(pendingFile(root), 'utf8')) : null;
  if (pending && (pending.issue !== binding.issue || !shards.some(shard => shard.run_id === pending.run_id))) {
    throw new Error('pending publication belongs to another run; reconcile before publishing');
  }
  const deadline = Date.now() + 60000;
  const request = (method, path, data) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('delivery publication exceeded its 60s deadline');
    return api(method, path, data, Math.min(20000, remaining));
  };
  const viewer = await request('GET', 'user');
  if (!validToken(viewer?.login)) throw new Error('GitHub publisher identity unavailable');
  let outcome;
  for (const [index, payload] of shards.entries()) {
    const body = bodies[index], marker = `<!-- fitsy-delivery:v1:${payload.run_id} -->`;
    const matches = [];
    for (let page = 1; page <= 100; page++) {
      const comments = await request('GET', `repos/${repo}/issues/${binding.issue}/comments?per_page=100&page=${page}`);
      if (!Array.isArray(comments)) throw new Error('issue comments unavailable');
      matches.push(...comments.filter(comment => comment.body?.includes(marker)));
      if (comments.length < 100) break;
      if (page === 100) throw new Error('issue comment pagination limit reached');
    }
    if (matches.length > 1) throw new Error('duplicate delivery comments for run shard');
    if (matches.length) {
      const comment = matches[0];
      if (comment.user?.login !== viewer.login) throw new Error('delivery comment belongs to another author');
      const prior = existingPayload(comment.body, marker);
      if (prior.v !== 1 || prior.issue !== binding.issue || prior.run_id !== payload.run_id ||
          !Array.isArray(prior.events) || prior.events.some(event =>
            !validateEvent(event) || event.run_id !== payload.run_id || event.issue !== binding.issue)) {
        throw new Error('existing delivery comment identity mismatch');
      }
      if (pending?.run_id === payload.run_id) { unlinkSync(pendingFile(root)); pending = null; }
      if (JSON.stringify(prior.events) === JSON.stringify(payload.events) && prior.updated_at === payload.updated_at) {
        outcome = { action: 'unchanged', id: comment.id };
      } else {
        const updated = await request('PATCH', `repos/${repo}/issues/comments/${comment.id}`, { body });
        outcome = { action: 'updated', id: updated.id };
      }
    } else {
      if (pending) throw new Error('prior comment creation is uncertain; reconcile issue comments before retrying');
      writeFileSync(pendingFile(root), `${JSON.stringify({ issue: binding.issue, run_id: payload.run_id })}\n`,
        { flag: 'wx', mode: 0o600 });
      const created = await request('POST', `repos/${repo}/issues/${binding.issue}/comments`, { body });
      unlinkSync(pendingFile(root));
      outcome = { action: 'created', id: created.id };
    }
    recordPublication(root, payload, outcome.id);
  }
  recordPublication(root, logical, outcome.id, 'logical');
  return shards.length === 1 ? outcome : { ...outcome, shards: shards.length };
}

export async function publish(root, api = ghApi, now) {
  return withAsyncLock(root, () => {
    const { binding, logical } = withSyncLock(root, () => {
      const binding = readBinding(root);
      if (!binding) throw new Error('bind an issue before publishing delivery events');
      return { binding, logical: buildSummary(binding.issue, binding.run_id, readRows(root), now ?? new Date().toISOString()) };
    });
    return publishUnlocked(root, api, binding, logical);
  });
}

async function ghApi(method, path, data, timeoutMs = 20000) {
  return new Promise((resolvePromise, reject) => {
    const args = ['api', '-X', method, path];
    if (data) args.push('--input', '-');
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 4_000_000) child.kill(); });
    child.stderr.on('data', chunk => { error += chunk; if (error.length > 4000) child.kill(); });
    child.on('error', () => reject(new Error(`gh api ${method} failed or timed out`)));
    child.on('close', code => {
      if (code !== 0) reject(new Error(`gh api ${method} failed (exit ${code})`));
      else { try { resolvePromise(JSON.parse(output)); } catch { reject(new Error('invalid gh api response')); } }
    });
    child.stdin.end(data ? JSON.stringify(data) : undefined);
  });
}

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const key = arg.slice(2);
    result[key] = key === 'new-run' ? true : argv[++i];
  }
  return result;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const args = options(argv), root = process.cwd();
  if (command === 'bind') console.log(JSON.stringify(bind(root, Number(args.issue), Boolean(args['new-run']))));
  else if (command === 'begin' || command === 'auto-begin') {
    const extras = Object.fromEntries([['round_id', args['round-id']], ['lens', args.lens], ['check', args.check],
      ['source_sha', args['source-sha']]]
      .filter(([, value]) => value !== undefined));
    console.log(start(root, args.phase, command === 'begin' ? 'cli' : args.producer, extras) ?? '');
  } else if (command === 'end' || command === 'auto-end') {
    const result = finish(root, args['attempt-id'], args.status, new Date().toISOString(), args['source-sha']);
    if (command === 'end') console.log(JSON.stringify(result));
  } else if (command === 'summary') {
    const binding = readBinding(root);
    if (!binding) throw new Error('bind an issue before summarizing');
    console.log(JSON.stringify(buildSummary(binding.issue, binding.run_id, readRows(root), new Date().toISOString())));
  } else if (command === 'publish') console.log(JSON.stringify(await publish(root)));
  else throw new Error('usage: phase-events.mjs bind --issue N [--new-run] | begin --phase P | end --attempt-id ID --status S | summary | publish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
