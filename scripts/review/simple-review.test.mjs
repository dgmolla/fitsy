import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { review, runAgent, selectLenses, validateReview } from './simple-review.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lenses = ['correctness', 'workflow-security'];
const finding = { domains: ['correctness'], severity: 'CONFIRMED', priority: 'P1', file: 'scripts/example.js',
  line: 1, summary: 'Empty input crashes', scenario: 'An empty request throws instead of returning a result',
  impact: 'Every empty request breaks the documented core flow', fix: 'Handle empty input before access' };
const verdict = (findings = []) => ({ findings, verdict: findings.some(f => f.severity === 'CONFIRMED') ? 'fail' : 'pass',
  domains: Object.fromEntries(lenses.map(lens => [lens,
    findings.some(f => f.severity === 'CONFIRMED' && f.domains.includes(lens)) ? 'fail' : 'pass'])) });
const fenced = result => '```json\n' + JSON.stringify(result) + '\n```';

test('all confidence/priority combinations preserve the raw verdict and only confirmed P0/P1 block', () => {
  for (const severity of ['CONFIRMED', 'PLAUSIBLE', 'NIT']) for (const priority of ['P0', 'P1', 'P2', 'P3']) {
    const raw = verdict([{ ...finding, severity, priority }]);
    const result = validateReview(fenced(raw), lenses);
    assert.equal(result.blocking, severity === 'CONFIRMED' && ['P0', 'P1'].includes(priority));
    assert.deepEqual(result.findings, raw.findings);
    assert.equal(result.verdict, raw.verdict);
  }
  assert.equal(validateReview(fenced(verdict()), lenses).blocking, false);
});

test('malformed, incomplete, contradictory and ambiguous responses never pass', () => {
  const bad = [null, {}, { ...verdict(), domains: { correctness: 'pass' } },
    { ...verdict(), verdict: 'fail' }, { ...verdict([finding]), verdict: 'pass' },
    ...[{ severity: 'UNKNOWN' }, { priority: 'P9' }, { priority: ['P1'] }, { impact: '' }, { line: -1 }, { line: true },
      { domains: [] }, { domains: ['unknown'] }, { fix: '' }].map(change => verdict([{ ...finding, ...change }])),
    verdict(Array.from({ length: 6 }, () => ({ ...finding, severity: 'NIT' })))];
  for (const value of bad) assert.throws(() => validateReview(fenced(value), lenses));
  for (const text of ['', '{', fenced(verdict()) + fenced(verdict()), fenced(verdict()) + '\nunfinished']) {
    assert.throws(() => validateReview(text, lenses));
  }
});

test('the retained router selects existing lenses from PR paths', () => {
  for (const [path, expected] of [['apps/api/app/api/example.ts', 'danger-zone'],
    ['apps/mobile/app/index.tsx', 'danger-zone'], ['scripts/review/new.mjs', 'workflow-security'],
    ['docs/product/spec.md', 'spec-conformance'], ['docs/design/brief.md', 'docs-sanity']]) {
    assert.deepEqual(selectLenses(path + '\n'), ['correctness', expected]);
  }
});

function fixture(t, output = fenced(verdict()), mode = '') {
  const directory = mkdtempSync(join(tmpdir(), 'simple-review-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const worktree = join(directory, 'candidate'), bin = join(directory, 'bin'), log = join(directory, 'provider.json');
  mkdirSync(worktree); mkdirSync(bin); mkdirSync(join(worktree, 'scripts'));
  const git = (...args) => execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Review fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(worktree, 'scripts/example.js'), 'export const value = 1;\n');
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  writeFileSync(join(worktree, 'scripts/example.js'), 'export const value = 2;\n');
  git('commit', '-qam', 'candidate'); const head = git('rev-parse', 'HEAD');
  writeFileSync(join(bin, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const prompt = fs.readFileSync(0, 'utf8'), args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ prompt, args, env: process.env, cwd: process.cwd(), pid: process.pid }));
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], ${JSON.stringify(output)});
${mode === 'timeout' ? 'setInterval(() => {}, 1000);' : `process.exit(${mode === 'fail' ? 1 : 0});`}
`);
  chmodSync(join(bin, 'codex'), 0o755);
  const env = { PATH: bin + ':' + process.env.PATH, CODEX_API_KEY: 'fixture-key', GH_TOKEN: 'must-not-reach-provider',
    GITHUB_REPOSITORY: 'example/fitsy', GITHUB_EVENT_NAME: 'pull_request', NODE_OPTIONS: '--invalid-parent-option' };
  const event = { number: 3, pull_request: { state: 'open', title: 'Example', body: '$(touch DO_NOT_CREATE)', labels: [],
    head: { sha: head, repo: { full_name: env.GITHUB_REPOSITORY } }, base: { sha: base, repo: { full_name: env.GITHUB_REPOSITORY } } } };
  const writes = [], comments = [];
  const api = async (path, method, body) => {
    if (method !== 'GET') { writes.push({ path, method, body }); return {}; }
    if (path.startsWith('pulls/')) return structuredClone(event.pull_request);
    assert.match(path, /^issues\/3\/comments\?per_page=100&page=\d+$/);
    return comments;
  };
  return { event, worktree, root, env, api, writes, comments, log, git };
}

test('real Git diff reaches one isolated provider; one bot comment is created then updated', async t => {
  const f = fixture(t, fenced(verdict([{ ...finding, priority: 'P2' }])));
  assert.equal(await review(f.event, f), 0);
  const provider = JSON.parse(readFileSync(f.log, 'utf8'));
  assert.match(provider.prompt, /\+export const value = 2/);
  assert.match(provider.prompt, /Required domains: \["correctness","workflow-security"\]/);
  assert.match(provider.prompt, /\$\(touch DO_NOT_CREATE\)/);
  assert.equal(provider.env.GH_TOKEN, undefined); assert.equal(provider.env.NODE_OPTIONS, undefined);
  assert.equal(provider.args[provider.args.indexOf('--sandbox') + 1], 'read-only');
  assert.notEqual(provider.cwd, f.worktree); assert.equal(existsSync(provider.cwd), false);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].method, 'POST');
  assert.match(f.writes[0].body.body, /P2/); assert.match(f.writes[0].body.body, /advisory/);
  f.comments.push({ id: 9, user: { login: 'author' }, body: f.writes[0].body.body },
    { id: 10, user: { login: 'github-actions[bot]' }, body: f.writes[0].body.body });
  assert.equal(await review(f.event, f), 0);
  assert.equal(f.writes.length, 2); assert.equal(f.writes[1].method, 'PATCH');
  assert.equal(f.writes[1].path, 'issues/comments/10');
});

test('confirmed P1 fails; failed execution and malformed output publish incomplete rather than pass', async t => {
  for (const [output, mode, expected] of [[fenced(verdict([finding])), '', 1],
    [fenced(verdict()), 'fail', 2], ['truncated result', '', 2]]) {
    const f = fixture(t, output, mode);
    assert.equal(await review(f.event, f), expected);
    assert.equal(f.writes.length, 1);
    assert.match(f.writes[0].body.body, expected === 1 ? /require fixes/ : /incomplete/);
  }
});

test('forks and skip-review do not invoke the provider or post comments', async t => {
  for (const kind of ['fork', 'label']) {
    const f = fixture(t);
    if (kind === 'fork') f.event.pull_request.head.repo.full_name = 'other/fitsy';
    else f.event.pull_request.labels.push({ name: 'skip-review' });
    assert.equal(await review(f.event, f), 0);
    assert.equal(existsSync(f.log), false); assert.deepEqual(f.writes, []);
  }
  const f = fixture(t); f.env.GITHUB_EVENT_NAME = 'pull_request_target';
  await assert.rejects(review(f.event, f), /Only pull_request/);
  assert.equal(existsSync(f.log), false);
});

test('changed head/base or skip label during review cannot publish a stale result', async t => {
  for (const change of [pr => { pr.head.sha = 'a'.repeat(40); }, pr => { pr.base.sha = 'b'.repeat(40); },
    pr => { pr.labels.push({ name: 'skip-review' }); }]) {
    const f = fixture(t), original = f.api; let reads = 0;
    f.api = async (...args) => {
      const result = await original(...args);
      if (args[0].startsWith('pulls/') && ++reads > 1) change(result);
      return result;
    };
    await assert.rejects(review(f.event, f), /superseded/);
    assert.deepEqual(f.writes, []);
  }
});

test('provider timeout rejects even a complete result written before the hang and cleans its temporary home', async t => {
  const f = fixture(t, fenced(verdict()), 'timeout');
  await assert.rejects(runAgent('codex', 'Review', f.worktree, { env: f.env, timeout: 500 }), /timed out/);
  const provider = JSON.parse(readFileSync(f.log, 'utf8'));
  assert.equal(existsSync(provider.cwd), false);
  await assert.rejects(runAgent('unknown', 'Review', f.worktree, { env: f.env }), /Unsupported/);
});

test('comment pagination finds the existing bot comment and publication failure cannot pass', async t => {
  const f = fixture(t), original = f.api;
  f.api = async (...args) => {
    if (args[0].endsWith('&page=1')) return Array.from({ length: 100 }, () => ({ user: { login: 'author' }, body: '' }));
    if (args[0].endsWith('&page=2')) return [{ id: 7, user: { login: 'github-actions[bot]' }, body: '<!-- fitsy-simple-review:v1 -->' }];
    return original(...args);
  };
  assert.equal(await review(f.event, f), 0);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].path, 'issues/comments/7');
  const paginated = f.api;
  f.api = (...args) => { if (args[1] === 'PATCH') throw new Error('GitHub unavailable'); return paginated(...args); };
  await assert.rejects(review(f.event, f), /GitHub unavailable/);
});

test('PR merge-base diff excludes base-only changes; wrong checkout never invokes a reviewer', async t => {
  const f = fixture(t), pr = f.event.pull_request;
  f.git('checkout', '-qb', 'base-progress', pr.base.sha);
  writeFileSync(join(f.worktree, 'scripts/base-only.js'), 'base change\n');
  f.git('add', '.'); f.git('commit', '-qm', 'base advanced'); pr.base.sha = f.git('rev-parse', 'HEAD');
  f.git('checkout', '-q', pr.head.sha);
  assert.equal(await review(f.event, f), 0);
  assert.doesNotMatch(JSON.parse(readFileSync(f.log, 'utf8')).prompt, /base-only\.js/);
  rmSync(f.log); f.git('checkout', '-q', pr.base.sha);
  assert.equal(await review(f.event, f), 2);
  assert.equal(existsSync(f.log), false);
});
