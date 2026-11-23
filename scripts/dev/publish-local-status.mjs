#!/usr/bin/env node
// One command for the manual step that blocked four tooling PRs in one week (weekly maintenance, #1054): publish
// `product-flow/local` for a PR whose CI marked media integration required. It always works from a clean worktree at the PR
// head with its own `npm ci` (a symlinked node_modules and untracked files are rejected by the checks), republishes after an
// update-branch, and removes the worktree even on failure.
// Usage: node scripts/dev/publish-local-status.mjs <PR number> [--dry-run]
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = 'dgmolla/fitsy';

// Pure: the ordered steps, so the order and the safety properties are testable.
export function plan(pr, { worktreeRoot = resolve(homedir(), 'fitsy-wt'), envFile = 'apps/mobile/.env.development.local', branch } = {}) {
  if (!/^[1-9]\d*$/.test(String(pr))) throw new Error('PR number must be a positive integer');
  const dir = resolve(worktreeRoot, `pub-${pr}`);
  const publish = ['node', `--env-file=${envFile}`, 'scripts/sim/publish-product-flow.mjs', String(pr)];
  return {
    dir, branch,
    steps: [
      { name: 'fetch', cmd: ['git', 'fetch', '-q', 'origin', branch, 'main'] },
      { name: 'worktree', cmd: ['git', 'worktree', 'add', '-q', dir, `origin/${branch}`] },
      { name: 'install', cwd: dir, cmd: ['npm', 'ci', '--no-audit', '--no-fund'] },
      { name: 'env', copyEnv: { from: envFile, to: resolve(dir, envFile) } },
      { name: 'media', cwd: dir, cmd: ['bash', 'scripts/verify/media-integration.sh'] },
      { name: 'publish', cwd: dir, cmd: publish, retryAfterUpdateBranch: ['gh', 'pr', 'update-branch', String(pr), '--repo', repo] },
    ],
    cleanup: ['git', 'worktree', 'remove', '--force', dir],
  };
}

const run = (cmd, cwd) => execFileSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function execute(pr, { dry = false, exec = run, copy = (from, to) => exec(['cp', from, to]), log = line => process.stdout.write(`${line}\n`), headBranch } = {}) {
  const branch = headBranch ?? JSON.parse(exec(['gh', 'pr', 'view', String(pr), '--repo', repo, '--json', 'headRefName'])).headRefName;
  const { steps, cleanup, dir } = plan(pr, { branch });
  if (dry) { for (const step of steps) log(`${step.name}: ${step.cmd ? step.cmd.join(' ') : 'copy dev env'}`); log(`cleanup: ${cleanup.join(' ')}`); return { dry: true }; }
  try {
    for (const step of steps) {
      if (step.copyEnv) { copy(step.copyEnv.from, step.copyEnv.to); continue; }
      try { log(`${step.name}: ${exec(step.cmd, step.cwd).trim().split('\n').pop()}`); }
      catch (error) {
        if (!step.retryAfterUpdateBranch) throw error;
        // The PR fell behind main (a merge landed meanwhile): update it, refetch the head, and publish once more at the new head.
        exec(step.retryAfterUpdateBranch);
        exec(['git', 'fetch', '-q', 'origin', branch]);
        exec(['git', 'checkout', '-q', '--detach', `origin/${branch}`], dir);
        exec(['bash', 'scripts/verify/media-integration.sh'], dir);
        log(`${step.name} (after update-branch): ${exec(step.cmd, step.cwd).trim().split('\n').pop()}`);
      }
    }
    return { dry: false };
  } finally {
    try { exec(cleanup); } catch { /* the worktree may already be gone */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [pr] = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
  try { execute(pr, { dry: process.argv.includes('--dry-run') }); }
  catch (error) { process.stderr.write(`${String(error.message).split('\n')[0]}\n`); process.exit(1); }
}
