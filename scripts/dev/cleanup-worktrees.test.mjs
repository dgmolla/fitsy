import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupMergedWorktrees, listWorktrees } from './cleanup-worktrees.mjs';
import { admitDisk } from '../sim/runner-controls.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'fitsy-cleanup-wt-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'main');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.name', 'T'); git(repo, 'config', 'user.email', 't@example.test');
  writeFileSync(join(repo, 'a.txt'), 'a'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
  const add = (name, { dirty = false, extraCommit = false, detached = false } = {}) => {
    const path = join(base, name);
    if (detached) git(repo, 'worktree', 'add', '-q', '--detach', path);
    else git(repo, 'worktree', 'add', '-q', '-b', `codex/${name}`, path);
    if (extraCommit) { writeFileSync(join(path, 'b.txt'), 'b'); git(path, 'add', '.'); git(path, 'commit', '-qm', name); }
    if (dirty) writeFileSync(join(path, 'scratch.txt'), 'uncommitted');
    return { path, head: git(path, 'rev-parse', 'HEAD') };
  };
  return { base, repo, add };
}

test('removes only clean, idle worktrees whose exact head belongs to a merged PR', t => {
  const { repo, add } = fixture(t);
  const merged = add('merged', { extraCommit: true });
  const dirty = add('dirty', { extraCommit: true, dirty: true });
  const active = add('active', { extraCommit: true });
  const open = add('open-pr', { extraCommit: true });
  const differs = add('head-differs', { extraCommit: true });
  const detached = add('detached', { detached: true });
  const heads = { 'codex/merged': [merged.head], 'codex/dirty': [dirty.head], 'codex/active': [active.head],
    'codex/open-pr': [], 'codex/head-differs': ['0'.repeat(40)] };
  const options = { repo, cwds: [join(active.path, 'apps/mobile')], mergedHeads: branch => heads[branch] ?? [], caller: repo };

  const dry = cleanupMergedWorktrees({ ...options, apply: false });
  assert.deepEqual(dry.candidates, [merged.path]);
  assert.equal(existsSync(merged.path), true, 'dry run removes nothing');

  const result = cleanupMergedWorktrees({ ...options, apply: true });
  assert.deepEqual(result.removed, [merged.path]);
  assert.deepEqual(result.refused, []);
  assert.equal(existsSync(merged.path), false);
  for (const kept of [dirty, active, open, differs, detached]) assert.equal(existsSync(kept.path), true, kept.path);
  const reasons = Object.fromEntries(result.skipped.map(item => [item.path, item.reason]));
  assert.match(reasons[dirty.path], /uncommitted/);
  assert.match(reasons[active.path], /active process/);
  assert.match(reasons[open.path], /exact head/);
  assert.match(reasons[differs.path], /exact head/);
  assert.match(reasons[detached.path], /detached/);
  assert.equal(listWorktrees(repo).some(item => item.path === merged.path), false, 'registration is pruned');
});

test('never removes the main checkout, a locked worktree, or the caller\'s own worktree', t => {
  const { repo, add } = fixture(t);
  const locked = add('locked', { extraCommit: true });
  const mine = add('mine', { extraCommit: true });
  git(repo, 'worktree', 'lock', locked.path);
  const result = cleanupMergedWorktrees({ repo, apply: true, cwds: [], caller: join(mine.path, 'scripts'),
    mergedHeads: branch => [locked.head, mine.head] });
  assert.deepEqual(result.removed, []);
  assert.equal(existsSync(repo), true);
  assert.equal(existsSync(locked.path), true);
  assert.equal(existsSync(mine.path), true);
  assert.deepEqual(result.skipped.map(item => item.reason).sort(), ['caller is inside it', 'locked']);
});

test('a failed merged-PR lookup keeps the worktree', t => {
  const { repo, add } = fixture(t);
  const one = add('lookup', { extraCommit: true });
  const result = cleanupMergedWorktrees({ repo, apply: true, cwds: [], caller: repo, mergedHeads: () => { throw new Error('gh down'); } });
  assert.deepEqual(result.removed, []);
  assert.equal(existsSync(one.path), true);
  assert.match(result.skipped[0].reason, /lookup failed/);
});

test('admitDisk removes merged worktrees once on a shortage, keeps the real error, and is skippable', t => {
  const path = tmpdir();
  const calls = [];
  assert.throws(() => admitDisk(path, 'Native run', 1e9, dir => calls.push(dir)), /needs 1000000000 GiB free.*after removing merged worktrees/);
  assert.deepEqual(calls, [path]);
  assert.throws(() => admitDisk(path, 'Native run', 1e9, () => { throw new Error('cleanup exploded'); }), /needs 1000000000 GiB free/);
  assert.doesNotThrow(() => admitDisk(path, 'Native run', 0.001, () => assert.fail('no cleanup when space is sufficient')));
  const previous = process.env.FITSY_AUTO_CLEANUP;
  t.after(() => { if (previous === undefined) delete process.env.FITSY_AUTO_CLEANUP; else process.env.FITSY_AUTO_CLEANUP = previous; });
  process.env.FITSY_AUTO_CLEANUP = '0';
  assert.throws(() => admitDisk(path, 'Native run', 1e9, () => assert.fail('disabled')), /needs 1000000000 GiB free/);
});
