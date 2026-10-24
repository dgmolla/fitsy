import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bind, buildSummary, finish, publish, readRows, start, validateEvent } from './phase-events.mjs';
import { parseTiming } from './phase-report.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-delivery-events-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('commit', '--allow-empty', '-qm', 'base');
  return { root, head: git('rev-parse', 'HEAD') };
}

function github() {
  const comments = [], calls = [];
  let failAfterCreate = false;
  const api = async (method, path, data, timeoutMs) => {
    calls.push({ method, path, timeoutMs });
    if (path === 'user') return { login: 'dgmolla' };
    if (method === 'GET' && path.includes('/comments?')) return comments;
    if (method === 'POST') {
      const comment = { id: comments.length + 1, body: data.body, user: { login: 'dgmolla' } };
      comments.push(comment);
      if (failAfterCreate) throw new Error('response lost after remote create');
      return comment;
    }
    if (method === 'PATCH') {
      const comment = comments.find(item => path.endsWith(`/${item.id}`));
      comment.body = data.body;
      return comment;
    }
    throw new Error(`unexpected API ${method} ${path}`);
  };
  return { api, comments, calls, loseCreateResponse: () => { failAfterCreate = true; } };
}

function publishedEvents(payloads, logicalRunId) {
  return payloads.flatMap(payload => payload.events.map(event => {
    assert.equal(event.run_id, payload.run_id);
    return { ...event, run_id: logicalRunId };
  }));
}

function publishedPayloads(comments) {
  return comments.map(comment => JSON.parse(comment.body.match(/```json\n([^\n]+)/)[1]));
}

test('bind, begin and end retain observed attempt evidence without backfilling', async t => {
  const { root, head } = fixture(t);
  const binding = bind(root, 355);
  assert.equal(bind(root, 355).run_id, binding.run_id);
  assert.throws(() => bind(root, 356), /different issue/);
  const beginAt = '2026-09-26T19:00:00.000Z';
  const endAt = '2026-09-26T19:00:02.250Z';
  const attempt = start(root, 'implementation', 'cli', {}, beginAt);
  assert.throws(() => bind(root, 356, true), /finish active/);
  const running = buildSummary(355, binding.run_id, readRows(root), beginAt).events[0];
  assert.equal(running.status, 'running');
  assert.equal(running.finished_at, null);
  const ended = finish(root, attempt, 'pass', endAt);
  assert.equal(ended.duration_ms, 2250);
  assert.equal(ended.source_sha, head);
  assert.throws(() => finish(root, attempt, 'pass', endAt), /finished/);
  const summary = buildSummary(355, binding.run_id, readRows(root), endAt);
  assert.equal(summary.events.length, 1);
  assert.equal(summary.events[0].status, 'pass');
  assert.equal(summary.events[0].duration_ms, 2250);
  assert.equal(readRows(root).length, 2);
  assert.throws(() => bind(root, 356, true), /publish prior run/);
  await publish(root, github().api, '2026-09-26T19:00:03.000Z');
  const newBinding = bind(root, 356, true);
  assert.notEqual(newBinding.run_id, binding.run_id);
  assert.equal(readRows(root).length, 2);
});

test('cached attempts are zero-time snapshots and validation rejects invented data', t => {
  const { root, head } = fixture(t);
  const binding = bind(root, 355);
  const attempt = start(root, 'review', 'review-lens', { lens: 'correctness', round_id: head,
    source_sha: head }, '2026-09-26T19:00:00.000Z');
  const row = finish(root, attempt, 'cached', '2026-09-26T19:00:08.000Z', head);
  assert.equal(row.started_at, row.finished_at);
  assert.equal(row.duration_ms, 0);
  assert.equal(buildSummary(355, binding.run_id, readRows(root), row.finished_at).events[0].status, 'cached');
  assert.throws(() => validateEvent({ ...row, duration_ms: 8000 }), /duration/);
  assert.throws(() => validateEvent({ ...row, detail: 'raw log' }), /fields/);
  assert.throws(() => validateEvent({ ...row, producer: 'review/lens' }), /invalid delivery event/);
  assert.throws(() => buildSummary(355, binding.run_id, readRows(root), '2026-09-26T18:59:00.000Z'), /predates/);
});

test('publication shards a long logical run without losing attempts', async t => {
  const { root } = fixture(t);
  const binding = bind(root, 355);
  const at = '2026-09-26T19:00:00.000Z';
  for (let i = 0; i < 51; i++) finish(root, start(root, 'unit', 'verify-run', { check: 'test' }, at), 'pass', at);
  const logicalEvents = buildSummary(355, binding.run_id, readRows(root), at).events;
  const fake = github();
  assert.deepEqual(await publish(root, fake.api, at), { action: 'created', id: 2, shards: 2 });
  const payloads = publishedPayloads(fake.comments);
  assert.deepEqual(payloads.map(item => [item.run_id, item.events.length]),
    [[binding.run_id, 50], [`${binding.run_id}.p2`, 1]]);
  assert.ok(payloads.every(item => item.events.every(event => event.run_id === item.run_id)));
  assert.deepEqual(publishedEvents(payloads, binding.run_id), logicalEvents);
  const mutated = structuredClone(payloads);
  mutated[1].events[0] = { ...mutated[0].events[0], run_id: mutated[1].run_id };
  assert.throws(() => assert.deepEqual(publishedEvents(mutated, binding.run_id), logicalEvents),
    { name: 'AssertionError' });
  assert.ok(fake.comments.every(comment => parseTiming({ ...comment, author_association: 'OWNER' }, 355, Date.parse(at))));
  bind(root, 355, true);
  assert.ok(start(root, 'implementation', 'cli', {}, at));
});

test('parallel publishers and initial bind share one exclusive ledger lock', async t => {
  const { root } = fixture(t);
  const cli = new URL('./phase-events.mjs', import.meta.url).pathname;
  const launch = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'bind', '--issue', '355'], { cwd: root });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(`bind exited ${code}`)));
  });
  const [a, b] = await Promise.all([launch(), launch()]);
  assert.equal(a.run_id, b.run_id);
  const at = '2026-09-26T19:00:00.000Z';
  finish(root, start(root, 'unit', 'verify-run', {}, at), 'pass', at);
  const fake = github();
  const delayed = async (...args) => {
    if (args[0] === 'POST') await new Promise(resolve => setTimeout(resolve, 50));
    return fake.api(...args);
  };
  await Promise.all([publish(root, delayed, at), publish(root, delayed, at)]);
  assert.equal(fake.comments.length, 1);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
});

test('workers keep recording during publication and a waiting publisher sees their finish', async t => {
  const { root } = fixture(t);
  bind(root, 355);
  const attempt = start(root, 'implementation', 'cli');
  const fake = github();
  let entered, release;
  const blocked = new Promise(resolve => { entered = resolve; });
  const first = publish(root, async (...args) => {
    if (args[0] === 'POST') { entered(); await new Promise(resolve => { release = resolve; }); }
    return fake.api(...args);
  });
  await blocked;
  const second = publish(root, fake.api);
  assert.equal(bind(root, 355).issue, 355);
  const concurrent = start(root, 'unit', 'verify-run', { check: 'during-publish' });
  assert.throws(() => bind(root, 355, true), /delivery publish locked/);
  await new Promise(resolve => setTimeout(resolve, 10));
  finish(root, attempt, 'pass');
  finish(root, concurrent, 'pass');
  release();
  await Promise.all([first, second]);
  const latest = JSON.parse(fake.comments[0].body.match(/```json\n([^\n]+)/)[1]).events;
  assert.deepEqual(latest.map(event => event.status), ['pass', 'pass']);
  assert.equal(fake.comments.length, 1);
});

test('signal closeout records interruption and preserves process signal exit', { timeout: 10000 }, async t => {
  const { root } = fixture(t);
  const binding = bind(root, 355);
  const moduleUrl = new URL('./phase-events.mjs', import.meta.url).href;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const code = `import {start,finish,closeOnSignals} from ${JSON.stringify(moduleUrl)};
      const id=start(process.cwd(),'verification','verify-run',{check:'signal'});
      closeOnSignals(()=>finish(process.cwd(),id,'interrupted'));
      process.stdout.write('ready\\n'); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: root });
    t.after(() => { try { child.kill('SIGKILL'); } catch { /* Already stopped. */ } });
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
    child.kill(signal);
    const exit = await new Promise(resolve => child.once('close', (code, actualSignal) => resolve({ code, signal: actualSignal })));
    assert.deepEqual(exit, { code: null, signal });
  }
  const events = buildSummary(355, binding.run_id, readRows(root), new Date().toISOString()).events;
  assert.deepEqual(events.map(event => event.status), ['interrupted', 'interrupted']);
  assert.ok(events.every(event => event.duration_ms >= 0 && event.finished_at));
});

test('partial shard creation reconciles before logical run rotation', async t => {
  const { root } = fixture(t);
  const at = '2026-09-26T19:00:00.000Z';
  const binding = bind(root, 355);
  for (let i = 0; i < 51; i++) finish(root, start(root, 'unit', 'verify-run', {}, at), 'pass', at);
  const logicalEvents = buildSummary(355, binding.run_id, readRows(root), at).events;
  const fake = github();
  let posts = 0;
  await assert.rejects(publish(root, async (...args) => {
    const result = await fake.api(...args);
    if (args[0] === 'POST' && ++posts === 2) throw new Error('lost shard response');
    return result;
  }, at), /lost shard response/);
  assert.throws(() => bind(root, 355, true), /pending/);
  assert.equal(fake.comments.length, 2);
  assert.equal((await publish(root, fake.api, at)).shards, 2);
  assert.equal(fake.comments.length, 2);
  assert.deepEqual(publishedEvents(publishedPayloads(fake.comments), binding.run_id), logicalEvents);
  assert.ok(bind(root, 355, true).run_id);
});


test('publisher creates once, updates same authored comment, and rejects marker hijacking', async t => {
  const { root } = fixture(t);
  bind(root, 355);
  const attempt = start(root, 'implementation', 'cli', {}, '2026-09-26T19:00:00.000Z');
  const fake = github();
  const created = await publish(root, fake.api, '2026-09-26T19:00:01.000Z');
  assert.deepEqual(created, { action: 'created', id: 1 });
  assert.match(fake.comments[0].body, /^<!-- fitsy-delivery:v1:/);
  assert.equal((await publish(root, fake.api, '2026-09-26T19:00:01.000Z')).action, 'unchanged');
  assert.equal((await publish(root, fake.api, '2026-09-26T19:00:02.000Z')).action, 'updated');
  assert.equal(JSON.parse(fake.comments[0].body.match(/```json\n([^\n]+)/)[1]).updated_at,
    '2026-09-26T19:00:02.000Z');
  finish(root, attempt, 'pass', '2026-09-26T19:00:03.000Z');
  assert.equal((await publish(root, fake.api, '2026-09-26T19:00:04.000Z')).action, 'updated');
  assert.equal(fake.comments.length, 1);
  const ended = JSON.parse(fake.comments[0].body.match(/```json\n([^\n]+)/)[1]).events[0];
  assert.deepEqual([ended.status, ended.finished_at, ended.duration_ms], ['pass', '2026-09-26T19:00:03.000Z', 3000]);
  assert.ok(fake.calls.every(call => call.timeoutMs > 0 && call.timeoutMs <= 20000));
  fake.comments[0].user.login = 'untrusted';
  await assert.rejects(publish(root, fake.api, '2026-09-26T19:00:05.000Z'), /another author/);
});

test('uncertain comment creation blocks a duplicate until the remote comment is reconciled', async t => {
  const { root } = fixture(t);
  bind(root, 355);
  const attempt = start(root, 'implementation', 'cli', {}, '2026-09-26T19:00:00.000Z');
  finish(root, attempt, 'pass', '2026-09-26T19:00:01.000Z');
  const fake = github();
  fake.loseCreateResponse();
  await assert.rejects(publish(root, fake.api, '2026-09-26T19:00:02.000Z'), /response lost/);
  assert.equal(fake.comments.length, 1);
  const result = await publish(root, fake.api, '2026-09-26T19:00:03.000Z');
  assert.equal(result.action, 'updated');
  assert.equal(fake.comments.length, 1);
  assert.equal(existsSync(join(root, '.evidence/delivery/publish-pending.json')), false);
  const payload = JSON.parse(fake.comments[0].body.match(/```json\n([^\n]+)/)[1]);
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].duration_ms, 1000);
});
