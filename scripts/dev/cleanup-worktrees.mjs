#!/usr/bin/env node
// Remove merged, clean, idle worktrees right away (Dawit, 2026-11-14: no four-hour
// wait for merged work). Dry run by default; --apply removes. Dependency-free.
//
// A worktree is removed only when ALL hold: it is not the main checkout or the
// caller's own, it is unlocked, it has no uncommitted changes, no process has its
// cwd inside it, and a MERGED PR for its branch has a head SHA equal to the
// worktree HEAD (squash-merged branches always look unpushed to
// `git rev-list HEAD --not --remotes`, so the PR head is the proof of what
// reached GitHub). Branchless, no-PR, open-PR and head-differs worktrees are kept.
// Removal is plain `git worktree remove` (never --force); git refuses if unclean.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = 'dgmolla/fitsy';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

export function listWorktrees(repo) {
  return run('git', ['worktree', 'list', '--porcelain'], repo).split('\n\n').filter(Boolean).map(block => {
    const fields = Object.fromEntries(block.split('\n').map(line => {
      const [key, ...value] = line.split(' ');
      return [key, value.join(' ') || true];
    }));
    return { path: fields.worktree, head: fields.HEAD, branch: typeof fields.branch === 'string' ? fields.branch.replace('refs/heads/', '') : '',
      locked: Boolean(fields.locked), prunable: Boolean(fields.prunable) };
  });
}

export function activeCwds() {
  try {
    return run('lsof', ['-d', 'cwd', '-Fn']).split('\n').filter(line => line.startsWith('n/')).map(line => line.slice(1));
  } catch (error) {
    // lsof exits non-zero when it can read only some processes; keep what it printed.
    return String(error.stdout || '').split('\n').filter(line => line.startsWith('n/')).map(line => line.slice(1));
  }
}

export function mergedPrHeads(branch) {
  const out = run('gh', ['pr', 'list', '-R', REPO, '--state', 'merged', '--head', branch, '--json', 'headRefOid', '--limit', '20']);
  return JSON.parse(out || '[]').map(pr => pr.headRefOid);
}

const inside = (path, base) => path === base || path.startsWith(`${base}/`);
const real = path => { try { return realpathSync(path); } catch { return path; } };

export function cleanupMergedWorktrees({ repo = process.cwd(), apply = false, cwds = activeCwds(), mergedHeads = mergedPrHeads,
  caller = process.cwd() } = {}) {
  const [main, ...others] = listWorktrees(repo);
  const result = { applied: apply, removed: [], candidates: [], refused: [], skipped: [] };
  const callerReal = real(caller), cwdReals = cwds.map(real);
  for (const worktree of others) {
    const skip = reason => result.skipped.push({ path: worktree.path, reason });
    if (worktree.prunable) { skip('registration only (run git worktree prune)'); continue; }
    const path = real(worktree.path);
    if (worktree.locked) { skip('locked'); continue; }
    if (inside(callerReal, path)) { skip('caller is inside it'); continue; }
    if (cwdReals.some(cwd => inside(cwd, path))) { skip('active process'); continue; }
    if (!worktree.branch) { skip('no branch (detached)'); continue; }
    let dirty;
    try { dirty = run('git', ['status', '--porcelain'], worktree.path).trim(); } catch { skip('status unreadable'); continue; }
    if (dirty) { skip('uncommitted changes'); continue; }
    let heads;
    try { heads = mergedHeads(worktree.branch); } catch { skip('merged-PR lookup failed'); continue; }
    if (!heads.includes(worktree.head)) { skip('no merged PR with this exact head'); continue; }
    result.candidates.push(worktree.path);
    if (!apply) continue;
    try { run('git', ['worktree', 'remove', worktree.path], main.path); result.removed.push(worktree.path); }
    catch (error) { result.refused.push({ path: worktree.path, reason: String(error.stderr || error.message).trim().slice(0, 200) }); }
  }
  if (apply && result.removed.length) run('git', ['worktree', 'prune'], main.path);
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) { console.error('Usage: node scripts/dev/cleanup-worktrees.mjs [--apply]'); process.exit(2); }
  const summary = cleanupMergedWorktrees({ apply: args.includes('--apply') });
  console.log(JSON.stringify(summary, null, 2));
}
