import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSupervisorProblems, runChecks, slackStale, stalledBlockers, unackedHandoffs } from './loop-check.mjs';

const now = Date.parse('2026-11-18T22:00:00Z');
const ago = minutes => new Date(now - minutes * 60000).toISOString();

test('blocker handoffs warn after 30 minutes and others after 3 hours, only when nobody commented', () => {
  const issues = [
    { number: 1, createdAt: ago(31), labels: ['handoff', 'blocker'], commentCount: 0 },
    { number: 2, createdAt: ago(29), labels: ['handoff', 'blocker'], commentCount: 0 },
    { number: 3, createdAt: ago(200), labels: ['handoff'], commentCount: 0 },
    { number: 4, createdAt: ago(200), labels: ['handoff'], commentCount: 1 },
    { number: 5, createdAt: ago(100), labels: ['handoff'], commentCount: 0 },
  ];
  assert.deepEqual(unackedHandoffs(issues, now), [1, 3]);
});

test('slack liveness only matters during the day (9 AM to 10 PM Pacific)', () => {
  assert.equal(slackStale(now - 200 * 60000, now, 12), true);
  assert.equal(slackStale(now - 200 * 60000, now, 3), false);
  assert.equal(slackStale(now - 100 * 60000, now, 12), false);
});

test('every check reports a line, and a failing check is a warning, not a crash', () => {
  const run = (...args) => {
    if (args[0] === 'docker') throw new Error('Cannot connect to the Docker daemon');
    if (args[0] === 'ps') return '101 /bin/zsh supervise.sh opusplan\n';
    if (args[2] === '--label' || args.includes('--label')) return args.includes('handoff') ? JSON.stringify([{ number: 9, createdAt: ago(40), labels: [{ name: 'blocker' }], comments: [] }]) : '[]';
    return '[]';
  };
  const checks = runChecks({ now, run, exists: () => true, mtimeMs: () => now - 10 * 60000, home: '/h', hourPt: 12 });
  assert.deepEqual(checks.map(check => check.name), ['docker', 'supervisors', 'slack-liveness', 'handoffs', 'needs-dawit', 'blocked', 'supervisor-log', 'token-snapshot', 'stalled-blockers', 'idle-with-questions', 'external-config']);
  const byName = Object.fromEntries(checks.map(check => [check.name, check]));
  assert.equal(byName.docker.status, 'warn');
  assert.match(byName.supervisors.detail, /app/);
  assert.equal(byName['slack-liveness'].status, 'ok');
  assert.match(byName.handoffs.detail, /#9/);
});

test('external config drift is reported as a warning with the drift lines', () => {
  const drift = Object.assign(new Error('failed'), { status: 1, stdout: 'supabase dev auth external.anonymous_users: expected ON, actual OFF\n' });
  const run = (...args) => {
    if (args[0] === 'node') throw drift;
    if (args[0] === 'ps') return 'supervise.sh opusplan\nsupervise.sh app\n';
    return args[0] === 'gh' ? '[]' : 'ok';
  };
  const checks = runChecks({ now, run, exists: () => true, mtimeMs: () => now, home: '/h', hourPt: 12 });
  const config = checks.find(check => check.name === 'external-config');
  assert.equal(config.status, 'warn');
  assert.match(config.detail, /anonymous_users: expected ON, actual OFF/);
});

test('recent BLOCKED and network lines in the supervisor log are found, old and unrelated ones are not', () => {
  const now = Date.parse('2026-11-22T23:30:00Z'); // 15:30 PST
  const log = [
    '[2026-11-22 15:06:11 PST] [opusplan] network/API error (ENOTFOUND) - waiting on NetworkDiagnostics',
    '[2026-11-22 14:00:00 PST] [app] BLOCKED: usage-limit - stopping',
    '[2026-11-21 22:06:44 PST] [opusplan] network/API error (ENOTFOUND)',
    '[2026-11-22 15:10:00 PST] [app] idle/clean exit',
    'garbage line BLOCKED without a timestamp',
  ].join('\n');
  assert.equal(recentSupervisorProblems(log, now).length, 2);
});

test('blocker issues untouched for an hour are reported', () => {
  const now = Date.parse('2026-11-22T23:30:00Z');
  const ago = minutesAgo => new Date(now - minutesAgo * 60000).toISOString();
  assert.deepEqual(stalledBlockers([{ number: 1, updatedAt: ago(90) }, { number: 2, updatedAt: ago(20) }], now), [1]);
});
