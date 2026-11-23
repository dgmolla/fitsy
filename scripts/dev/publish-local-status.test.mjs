import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, plan } from './publish-local-status.mjs';

test('the plan installs its own dependencies in a clean worktree, runs media before publish, and always cleans up', () => {
  const { steps, cleanup, dir } = plan(1000, { worktreeRoot: '/w', branch: 'tooling/x' });
  assert.deepEqual(steps.map(step => step.name), ['fetch', 'worktree', 'install', 'env', 'media', 'publish']);
  assert.equal(dir, '/w/pub-1000');
  assert.deepEqual(steps.find(step => step.name === 'install').cmd, ['npm', 'ci', '--no-audit', '--no-fund']);
  assert.equal(steps.some(step => step.cmd?.includes('ln')), false, 'no symlinked node_modules');
  assert.deepEqual(cleanup, ['git', 'worktree', 'remove', '--force', '/w/pub-1000']);
  assert.throws(() => plan('1000; rm -rf /', { branch: 'x' }), /positive integer/);
  assert.throws(() => plan('0', { branch: 'x' }), /positive integer/);
});

test('a dry run only prints the steps', () => {
  const lines = [];
  const calls = [];
  execute(7, { dry: true, headBranch: 'b', exec: cmd => { calls.push(cmd); return ''; }, log: line => lines.push(line) });
  assert.equal(calls.length, 0);
  assert.ok(lines.some(line => line.startsWith('publish: node --env-file=')));
  assert.ok(lines.at(-1).startsWith('cleanup: git worktree remove'));
});

test('a publish that fails because the PR fell behind updates the branch and publishes again at the new head', () => {
  const calls = [];
  let publishes = 0;
  const exec = (cmd) => {
    calls.push(cmd.join(' '));
    if (cmd.includes('scripts/sim/publish-product-flow.mjs') && ++publishes === 1) throw new Error('Command failed: git merge-base --is-ancestor origin/main HEAD');
    return 'ok';
  };
  const logs = [];
  execute(55, { headBranch: 'tooling/y', exec, copy: () => {}, log: line => logs.push(line) });
  assert.equal(publishes, 2);
  assert.ok(calls.some(call => call.startsWith('gh pr update-branch 55')));
  assert.ok(calls.at(-1).startsWith('git worktree remove'));
});

test('a step that fails still removes the worktree and surfaces the error', () => {
  const calls = [];
  const exec = cmd => { calls.push(cmd.join(' ')); if (cmd[0] === 'npm') throw new Error('npm failed'); return 'ok'; };
  assert.throws(() => execute(9, { headBranch: 'b', exec, copy: () => {}, log: () => {} }), /npm failed/);
  assert.ok(calls.at(-1).startsWith('git worktree remove'), 'cleanup runs after the failure');
});
