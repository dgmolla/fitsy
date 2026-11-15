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
// Both the cleanliness check and the removal run with status.showUntrackedFiles=all
// so a user's `showUntrackedFiles=no` can never hide an untracked source file.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'dgmolla/fitsy';
// Ignored evidence dirs whose content is regenerated or already published. Any
// other entry under .evidence/ may be the only copy, so it is copied to a private
// archive outside the checkout before removal; if that fails the checkout is kept
// (the same preserve-or-retain contract as scripts/delivery/loop/worktrees.py).
const DISPOSABLE_EVIDENCE = new Set(['verify', 'product-flow', 'product-build', 'publication', 'sim-scope']);
const defaultArchiveRoot = () => process.env.FITSY_CLEANUP_ARCHIVE || join(homedir(), '.fitsy-cleanup-archive');
function archiveEvidence(worktreePath, names, archiveRoot) {
  const evidence = join(worktreePath, '.evidence');
  if (!lstatSync(evidence).isDirectory()) throw new Error('.evidence is not a plain directory');
  const destination = join(archiveRoot, `${basename(worktreePath)}-${Date.now()}`, '.evidence');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of names)
    cpSync(join(evidence, name), join(destination, name), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  return destination;
}
const GIT_STRICT = ['-c', 'status.showUntrackedFiles=all'];
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

// Fails closed: if the process inventory cannot be established (lsof missing or
// no output at all) nothing may be removed, because an empty list would read as
// "no active process". lsof exits 1 when it can read only some processes; its
// partial listing is kept.
export function activeCwds() {
  let stdout;
  try { stdout = run('lsof', ['-d', 'cwd', '-Fn']); }
  catch (error) { stdout = error.code === 'ENOENT' ? '' : String(error.stdout || ''); }
  const cwds = stdout.split('\n').filter(line => line.startsWith('n/')).map(line => line.slice(1));
  if (!cwds.length) throw new Error('process inventory unavailable; keeping every worktree');
  return cwds;
}

export function mergedPrHeads(branch) {
  const out = run('gh', ['pr', 'list', '-R', REPO, '--state', 'merged', '--head', branch, '--json', 'headRefOid', '--limit', '20']);
  return JSON.parse(out || '[]').map(pr => pr.headRefOid);
}

const inside = (path, base) => path === base || path.startsWith(`${base}/`);
const real = path => { try { return realpathSync(path); } catch { return path; } };

export function cleanupMergedWorktrees({ repo = process.cwd(), apply = false, cwds = activeCwds(), mergedHeads = mergedPrHeads,
  caller = process.cwd(), archiveRoot = defaultArchiveRoot() } = {}) {
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
    // `git worktree remove` deletes nested checkouts recursively without their own
    // dirty/locked/unmerged protections, and an ignored .claude/worktrees hides them.
    if ([main, ...others].some(other => other !== worktree && inside(real(other.path), path))) { skip('contains another registered worktree'); continue; }
    const nested = join(worktree.path, '.claude/worktrees');
    if (existsSync(nested) && readdirSync(nested).length) { skip('contains nested worktrees (.claude/worktrees)'); continue; }
    const evidence = join(worktree.path, '.evidence');
    const retained = existsSync(evidence) ? readdirSync(evidence).filter(name => !DISPOSABLE_EVIDENCE.has(name)) : [];
    let dirty;
    try { dirty = run('git', [...GIT_STRICT, 'status', '--porcelain=v1', '--untracked-files=all'], worktree.path).trim(); } catch { skip('status unreadable'); continue; }
    if (dirty) { skip('uncommitted changes'); continue; }
    let heads;
    try { heads = mergedHeads(worktree.branch); } catch { skip('merged-PR lookup failed'); continue; }
    if (!heads.includes(worktree.head)) { skip('no merged PR with this exact head'); continue; }
    result.candidates.push(worktree.path);
    if (!apply) continue;
    if (retained.length) {
      try { (result.archived ??= []).push({ path: worktree.path, archive: archiveEvidence(worktree.path, retained, archiveRoot) }); }
      catch (error) { result.refused.push({ path: worktree.path, reason: `evidence archive failed, checkout kept: ${String(error.message).slice(0, 160)}` }); continue; }
    }
    try { run('git', [...GIT_STRICT, 'worktree', 'remove', worktree.path], main.path); result.removed.push(worktree.path); }
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
