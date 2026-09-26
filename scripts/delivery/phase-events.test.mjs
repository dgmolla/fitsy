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
  const fake = github();
  assert.deepEqual(await publish(root, fake.api, at), { action: 'created', id: 2, shards: 2 });
  const payloads = fake.comments.map(comment => JSON.parse(comment.body.match(/```json\n([^\n]+)/)[1]));
  assert.deepEqual(payloads.map(item => [item.run_id, item.events.length]),
    [[binding.run_id, 50], [`${binding.run_id}.p2`, 1]]);
  assert.ok(payloads.every(item => item.events.every(event => event.run_id === item.run_id)));
  assert.ok(fake.comments.every(comment => parseTiming({ ...comment, author_association: 'OWNER' }, 355, Date.parse(at))));
  assert.equal(buildSummary(355, binding.run_id, readRows(root), at).events.length, 51);
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
  bind(root, 355);
  for (let i = 0; i < 51; i++) finish(root, start(root, 'unit', 'verify-run', {}, at), 'pass', at);
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
  assert.ok(bind(root, 355, true).run_id);
});

test('verify CLI records whole run, L2 check, reuse and SIGTERM in an owned fixture', async t => {
  const { root } = fixture(t);
  const source = new URL('../..', import.meta.url).pathname;
  mkdirSync(join(root, 'scripts/verify'), { recursive: true });
  mkdirSync(join(root, 'scripts/delivery'), { recursive: true });
  for (const name of ['run.mjs', 'impact-plan.mjs', 'receipt-cache.mjs']) {
    copyFileSync(join(source, 'scripts/verify', name), join(root, 'scripts/verify', name));
  }
  copyFileSync(join(source, 'scripts/delivery/phase-events.mjs'), join(root, 'scripts/delivery/phase-events.mjs'));
  symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, '.gitignore'), '.evidence/\nnode_modules/\n');
  writeFileSync(join(root, 'scripts/verify/registry.yml'), `checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 2\n    cache: true\n    blocking: true\n    runs: [local]\n`);
  writeFileSync(join(root, 'scripts/verify/fixture.sh'), `#!/bin/bash\nif test -e .evidence/slow; then\n  touch .evidence/check-started\n  while test ! -e .evidence/release; do sleep .05; done\nfi\nprintf '%s\\n' '{"name":"fixture","summary":"passed"}'\n`);
  execFileSync('git', ['add', 'scripts', '.gitignore'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'add fixture'], { cwd: root });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root });
  const binding = bind(root, 355);
  const isolatedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(GIT_|GITHUB_|FITSY_DIFF_|FITSY_RUNS$|CI$|PR_NUMBER$|FITSY_LOCAL_DB$|FITSY_VERIFY_|POSTGRES_PRISMA_URL$|POSTGRES_URL_NON_POOLING$)/.test(key)));
  const run = (...extra) => spawnSync(process.execPath, ['scripts/verify/run.mjs', '--layer=2', '--scope=all',
    '--runs=local', ...extra], { cwd: root, env: isolatedEnv, encoding: 'utf8', timeout: 10000 });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const second = run('--reuse');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /"cached":true/);
  const events = buildSummary(355, binding.run_id, readRows(root), new Date().toISOString()).events;
  assert.deepEqual(events.map(event => [event.phase, event.check, event.status]), [
    ['verification', 'whole', 'pass'], ['unit', 'fixture', 'pass'],
    ['verification', 'whole', 'pass'], ['unit', 'fixture', 'cached'],
  ]);
  assert.equal(events[3].duration_ms, 0);
  writeFileSync(join(root, '.evidence/slow'), '');
  const child = spawn(process.execPath, ['scripts/verify/run.mjs', '--layer=2', '--scope=all', '--runs=local'],
    { cwd: root, env: isolatedEnv });
  t.after(() => child.kill('SIGKILL'));
  for (let i = 0; i < 100 && !existsSync(join(root, '.evidence/check-started')); i++)
    await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(existsSync(join(root, '.evidence/check-started')), true, 'owned L2 check did not start');
  child.kill('SIGTERM');
  const exit = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  writeFileSync(join(root, '.evidence/release'), '');
  assert.deepEqual(exit, { code: null, signal: 'SIGTERM' });
  const interrupted = buildSummary(355, binding.run_id, readRows(root), new Date().toISOString()).events.slice(-2);
  assert.deepEqual(interrupted.map(event => [event.phase, event.check, event.status]),
    [['verification', 'whole', 'interrupted'], ['unit', 'fixture', 'interrupted']]);
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
