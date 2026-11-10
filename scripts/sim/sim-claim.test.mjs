import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const simPath = join(dirname(fileURLToPath(import.meta.url)), 'sim');

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-sim-home-'));
  mkdirSync(join(dir, 'fitsy-wt'), { recursive: true });
  return dir;
}
function sim(args, { HOME, FITSY_SIM_OWNER } = {}) {
  return spawnSync('bash', [simPath, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME, ...(FITSY_SIM_OWNER ? { FITSY_SIM_OWNER } : {}) },
  });
}
function deadPid() {
  // spawnSync returns the pid even though the process has already exited and
  // been reaped by the time it returns, so this pid is reliably not running.
  return spawnSync('true', []).pid;
}
function writeLock(dir, owner, pid) {
  writeFileSync(join(dir, 'fitsy-wt/simulator.lock'), JSON.stringify({ owner, pid }));
}

test('a second owner cannot claim while the first holder is unexpired, without --dead-holder-ok', () => {
  const HOME = home();
  try {
    assert.equal(JSON.parse(sim(['claim', '--minutes', '30'], { HOME, FITSY_SIM_OWNER: 'alice' }).stdout).status, 'pass');
    const blocked = sim(['claim', '--minutes', '30'], { HOME, FITSY_SIM_OWNER: 'bob' });
    assert.equal(blocked.status, 1);
    assert.equal(JSON.parse(blocked.stdout).summary, 'already claimed by alice');
  } finally { rmSync(HOME, { recursive: true, force: true }); }
});

test('--dead-holder-ok refuses takeover when the lock is missing, mismatched, or the holder is alive', () => {
  const HOME = home();
  try {
    assert.equal(JSON.parse(sim(['claim', '--minutes', '30'], { HOME, FITSY_SIM_OWNER: 'alice' }).stdout).status, 'pass');

    // No simulator.lock at all.
    assert.equal(sim(['claim', '--dead-holder-ok'], { HOME, FITSY_SIM_OWNER: 'bob' }).status, 1);

    // Lock owner does not match the current claim owner.
    writeLock(HOME, 'someone-else', deadPid());
    assert.equal(sim(['claim', '--dead-holder-ok'], { HOME, FITSY_SIM_OWNER: 'bob' }).status, 1);

    // Lock matches but the recorded PID is alive (this test process's own PID).
    writeLock(HOME, 'alice', process.pid);
    assert.equal(sim(['claim', '--dead-holder-ok'], { HOME, FITSY_SIM_OWNER: 'bob' }).status, 1);
  } finally { rmSync(HOME, { recursive: true, force: true }); }
});

test('--dead-holder-ok renews the claim immediately when the matching holder PID is dead', () => {
  const HOME = home();
  try {
    assert.equal(JSON.parse(sim(['claim', '--minutes', '30'], { HOME, FITSY_SIM_OWNER: 'alice' }).stdout).status, 'pass');
    writeLock(HOME, 'alice', deadPid());
    const takeover = sim(['claim', '--minutes', '45', '--dead-holder-ok'], { HOME, FITSY_SIM_OWNER: 'bob' });
    assert.equal(takeover.status, 0);
    const result = JSON.parse(takeover.stdout);
    assert.equal(result.status, 'pass'); assert.equal(result.owner, 'bob'); assert.equal(result.minutes, 45);
    const status = JSON.parse(sim(['status'], { HOME }).stdout);
    assert.equal(status.claimed_by, 'bob');
  } finally { rmSync(HOME, { recursive: true, force: true }); }
});
