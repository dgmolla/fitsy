import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bind, buildSummary, finish, publish, readRows, start, validateEvent } from './phase-events.mjs';

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

test('start stops before comment capacity and allows publication then rotation', async t => {
  const { root } = fixture(t);
  bind(root, 355);
  const at = '2026-09-26T19:00:00.000Z';
  for (let i = 0; i < 50; i++) finish(root, start(root, 'unit', 'verify-run', { check: 'test' }, at), 'pass', at);
  assert.throws(() => start(root, 'unit', 'verify-run', {}, at), /bind --new-run/);
  await publish(root, github().api, at);
  bind(root, 355, true);
  assert.ok(start(root, 'implementation', 'cli', {}, at));
});

test('verify CLI records whole run, L2 check, and zero-time reuse in an owned fixture', t => {
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
  writeFileSync(join(root, 'scripts/verify/fixture.sh'), `#!/bin/bash\nprintf '%s\\n' '{"name":"fixture","summary":"passed"}'\n`);
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
