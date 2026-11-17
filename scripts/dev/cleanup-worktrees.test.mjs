import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeCwds, cleanupMergedWorktrees, listWorktrees } from './cleanup-worktrees.mjs';
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

test('admitDisk removes merged worktrees once on a shortage, keeps the real error', () => {
  const path = tmpdir();
  const calls = [];
  assert.throws(() => admitDisk(path, 'Native run', 1e9, dir => calls.push(dir)), /needs 1000000000 GiB free.*after removing merged worktrees/);
  assert.deepEqual(calls, [path]);
  assert.throws(() => admitDisk(path, 'Native run', 1e9, () => { throw new Error('cleanup exploded'); }), /needs 1000000000 GiB free/);
  assert.doesNotThrow(() => admitDisk(path, 'Native run', 0.001, () => assert.fail('no cleanup when space is sufficient')));
});

test('an untracked file is never hidden by status.showUntrackedFiles=no', t => {
  const { repo, add } = fixture(t);
  const one = add('untracked', { extraCommit: true });
  git(repo, 'config', 'status.showUntrackedFiles', 'no');
  writeFileSync(join(one.path, 'new-source.ts'), 'export const precious = true;\n');
  assert.equal(git(one.path, 'status', '--porcelain'), '', 'precondition: the user config really hides it');
  const result = cleanupMergedWorktrees({ repo, apply: true, cwds: ['/nowhere'], caller: repo, mergedHeads: () => [one.head] });
  assert.deepEqual(result.removed, []);
  assert.equal(existsSync(join(one.path, 'new-source.ts')), true);
  assert.match(result.skipped[0].reason, /uncommitted/);
});

test('an unavailable process inventory aborts cleanup instead of reading as "nothing is active"', t => {
  const { repo, add } = fixture(t);
  const one = add('inventory', { extraCommit: true });
  const previous = process.env.PATH;
  t.after(() => { process.env.PATH = previous; });
  process.env.PATH = '/nonexistent-bin';
  assert.throws(() => activeCwds(), /process inventory unavailable/);
  assert.throws(() => cleanupMergedWorktrees({ repo, apply: true, caller: repo, mergedHeads: () => [one.head] }), /process inventory unavailable/);
  assert.equal(existsSync(one.path), true);
});

test('a merged parent is kept while it contains another worktree, even a dirty one hidden by an ignore rule', t => {
  const { repo, add } = fixture(t);
  appendFileSync(join(repo, '.git/info/exclude'), '.claude/\n.evidence/\n');
  const parent = add('parent', { extraCommit: true });
  mkdirSync(join(parent.path, '.claude/worktrees'), { recursive: true });
  const childPath = join(parent.path, '.claude/worktrees/child');
  git(repo, 'worktree', 'add', '-q', '-b', 'codex/child', childPath);
  writeFileSync(join(childPath, 'unfinished.ts'), 'export const precious = true;\n');
  assert.equal(git(parent.path, 'status', '--porcelain'), '', 'precondition: the parent looks clean');
  const result = cleanupMergedWorktrees({ repo, apply: true, cwds: ['/nowhere'], caller: repo, mergedHeads: branch => branch === 'codex/parent' ? [parent.head] : [] });
  assert.deepEqual(result.removed, []);
  assert.equal(existsSync(join(childPath, 'unfinished.ts')), true);
  assert.match(result.skipped.find(item => item.path === parent.path).reason, /contains another registered worktree/);
  // An unregistered nested checkout under .claude/worktrees is kept too.
  const lone = add('lone', { extraCommit: true });
  mkdirSync(join(lone.path, '.claude/worktrees/stray'), { recursive: true });
  writeFileSync(join(lone.path, '.claude/worktrees/stray/file.txt'), 'x');
  const again = cleanupMergedWorktrees({ repo, apply: true, cwds: ['/nowhere'], caller: repo, mergedHeads: branch => branch === 'codex/lone' ? [lone.head] : [] });
  assert.deepEqual(again.removed, []);
  assert.match(again.skipped.find(item => item.path === lone.path).reason, /nested worktrees/);
});

test('evidence that may be the only copy is archived outside the checkout before removal; a failed archive keeps the checkout', t => {
  const { base, repo, add } = fixture(t);
  appendFileSync(join(repo, '.git/info/exclude'), '.evidence/\n');
  const kept = add('archived', { extraCommit: true });
  mkdirSync(join(kept.path, '.evidence/chain-x'), { recursive: true });
  writeFileSync(join(kept.path, '.evidence/chain-x/run.log'), 'sole copy');
  mkdirSync(join(kept.path, '.evidence/verify/logs'), { recursive: true });
  writeFileSync(join(kept.path, '.evidence/verify/logs/a.log'), 'regenerated each run');
  const blocked = add('blocked', { extraCommit: true });
  mkdirSync(join(blocked.path, '.evidence'), { recursive: true });
  writeFileSync(join(blocked.path, '.evidence/run.log'), 'must survive a failed archive');
  const disposable = add('disposable', { extraCommit: true });
  mkdirSync(join(disposable.path, '.evidence/verify'), { recursive: true });
  writeFileSync(join(disposable.path, '.evidence/verify/b.log'), 'x');
  const heads = { 'codex/archived': [kept.head], 'codex/blocked': [blocked.head], 'codex/disposable': [disposable.head] };
  const archiveRoot = join(base, 'archive');
  const options = { repo, cwds: ['/nowhere'], caller: repo, mergedHeads: branch => heads[branch] };

  // A file where the archive directory must go makes archiving fail for the blocked checkout only.
  const blockedRoot = join(base, 'not-a-dir'); writeFileSync(blockedRoot, 'file');
  const failed = cleanupMergedWorktrees({ ...options, apply: true, archiveRoot: blockedRoot });
  assert.deepEqual(failed.removed, [disposable.path], 'only the checkout with nothing to archive is removed');
  assert.deepEqual(failed.refused.map(item => item.path).sort(), [blocked.path, kept.path].sort());
  assert.match(failed.refused[0].reason, /evidence archive failed, checkout kept/);
  assert.equal(existsSync(join(blocked.path, '.evidence/run.log')), true);
  assert.equal(existsSync(join(kept.path, '.evidence/chain-x/run.log')), true);

  const ok = cleanupMergedWorktrees({ ...options, apply: true, archiveRoot });
  assert.deepEqual(ok.removed.sort(), [blocked.path, kept.path].sort());
  assert.equal(existsSync(kept.path), false);
  const archive = ok.archived.find(item => item.path === kept.path).archive;
  assert.equal(readFileSync(join(archive, 'chain-x/run.log'), 'utf8'), 'sole copy');
  assert.equal(existsSync(join(archive, 'verify')), false, 'known-disposable evidence is not archived');
  assert.equal(readFileSync(join(ok.archived.find(item => item.path === blocked.path).archive, 'run.log'), 'utf8'), 'must survive a failed archive');
});

test('an immutable (read-only) native build cache in the evidence does not leave a half-removed checkout', t => {
  const { base, repo, add } = fixture(t);
  appendFileSync(join(repo, '.git/info/exclude'), '.evidence/\n');
  const merged = add('immutable-cache', { extraCommit: true });
  const bundle = join(merged.path, '.evidence/product-build/shared-native/key/Fitsy.app/_CodeSignature');
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, 'CodeResources'), 'signed');
  // The shared native cache is made immutable on purpose: directories and files lose their write bits.
  execFileSync('chmod', ['-R', 'a-w', join(merged.path, '.evidence/product-build')]);
  t.after(() => { try { execFileSync('chmod', ['-R', 'u+w', base]); } catch { /* already gone */ } });
  const result = cleanupMergedWorktrees({ repo, cwds: ['/nowhere'], caller: repo, apply: true, mergedHeads: () => [merged.head], archiveRoot: join(base, 'archive') });
  assert.deepEqual(result.removed, [merged.path], JSON.stringify(result.refused));
  assert.equal(existsSync(merged.path), false, 'no hollowed-out directory is left behind');
  assert.equal(git(repo, 'worktree', 'list', '--porcelain').includes('immutable-cache'), false, 'the registration is gone too');
});
