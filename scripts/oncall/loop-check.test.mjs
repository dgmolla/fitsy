import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSupervisorProblems, runChecks, redMainRuns, unrecordedRedRuns, slackStale, stalledBlockers, unackedHandoffs, weeklyMaintenanceDue } from './loop-check.mjs';

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
  assert.deepEqual(checks.map(check => check.name), ['docker', 'supervisors', 'slack-liveness', 'handoffs', 'needs-dawit', 'blocked', 'supervisor-log', 'token-snapshot', 'stalled-blockers', 'cost-snapshot', 'idle-with-questions', 'external-config', 'red-main', 'weekly-maintenance']);
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

test('cost alerts from the collector are surfaced as a warning and a quiet snapshot is ok', () => {
  const make = collectorOutput => (...args) => {
    if (args[0] === 'node' && String(args[1]).endsWith('collect.mjs')) return collectorOutput;
    if (args[0] === 'ps') return 'supervise.sh opusplan\nsupervise.sh app\n';
    return args[0] === 'gh' ? '[]' : 'ok';
  };
  const base = { now, exists: () => true, mtimeMs: () => now, home: '/h', hourPt: 12, readText: () => '' };
  const warn = runChecks({ ...base, run: make('cost snapshot: 1 of 17 services with data, projected $3\nALERT Upstash Redis is at 86% of its commands limit\n') }).find(check => check.name === 'cost-snapshot');
  assert.equal(warn.status, 'warn');
  assert.match(warn.detail, /Upstash Redis is at 86%/);
  const quiet = runChecks({ ...base, run: make('cost snapshot: 0 of 17 services with data, projected $0\n') }).find(check => check.name === 'cost-snapshot');
  assert.equal(quiet.status, 'ok');
});

test('weekly maintenance is due until a Weekly receipt comment lands within 8 days', () => {
  const receipt = days => ({ body: '**TL;DR:** Weekly receipt: guards shipped', createdAt: new Date(now - days * 86400000).toISOString() });
  assert.equal(weeklyMaintenanceDue([], now), true);
  assert.equal(weeklyMaintenanceDue(undefined, now), true);
  assert.equal(weeklyMaintenanceDue([{ body: 'ack', createdAt: ago(10) }], now), true);
  assert.equal(weeklyMaintenanceDue([receipt(9)], now), true);
  assert.equal(weeklyMaintenanceDue([receipt(3)], now), false);
});

test('a red post-merge run on main is flagged until a newer run of the same workflow is green', () => {
  const run = (workflowName, conclusion, databaseId) => ({ workflowName, conclusion, databaseId, headSha: 'abcdef123456' });
  assert.deepEqual(redMainRuns([run('Verify', 'failure', 3), run('Verify', 'success', 2), run('Main full suite', 'success', 1)]).map(item => item.databaseId), [3]);
  assert.deepEqual(redMainRuns([run('Verify', 'success', 4), run('Verify', 'failure', 3)]), []);
  assert.deepEqual(redMainRuns([run('Verify', null, 5), run('Verify', 'failure', 3)]).map(item => item.databaseId), [3]);
  assert.deepEqual(redMainRuns([run('Verify', 'success', 4), run('Main full suite', 'failure', 6)]).map(item => item.databaseId), [6]);
  assert.deepEqual(redMainRuns(undefined), []);
});

// #1077: a red post-merge run on main leaves a durable record even if a later run turns green before anyone looks.
const redRun = (id, workflowName = 'Verify', conclusion = 'failure') => ({ workflowName, conclusion, databaseId: id, headSha: 'abcdef1234567890' });

test('every red post-merge run not yet recorded is returned, even when a newer run is green', () => {
  const runs = [redRun(9, 'Verify', 'success'), redRun(8), redRun(7, 'Main full suite'), redRun(6, 'Production Monitor'), redRun(5, 'Verify', 'success')];
  assert.deepEqual(unrecordedRedRuns(runs, []).map(item => item.databaseId), [8, 7]);
  assert.deepEqual(unrecordedRedRuns(runs, [8]).map(item => item.databaseId), [7]);
  assert.deepEqual(unrecordedRedRuns(runs, [8, 7]), []);
  assert.deepEqual(unrecordedRedRuns(undefined, undefined), []);
});

const recordFixture = ({ runs, recorded = [], createFails = false, noState = false }) => {
  const calls = [];
  const writes = [];
  const run = (...args) => {
    calls.push(args);
    if (args[0] === 'gh' && args[1] === 'run' && args[2] === 'list') return JSON.stringify(runs);
    if (args[0] === 'gh' && args[1] === 'run' && args[2] === 'view') return 'Tests (L2) (scripts, 1/6), Tests (L2) (scripts, 6/6)';
    if (args[0] === 'gh' && args[1] === 'issue' && args[2] === 'create') { if (createFails) throw new Error('HTTP 502'); return 'https://github.com/dgmolla/fitsy/issues/9999'; }
    if (args[0] === 'ps') return 'supervise.sh opusplan\nsupervise.sh app\n';
    return args[0] === 'gh' ? '[]' : 'ok';
  };
  const readText = file => { if (file.endsWith('red-main-recorded.json')) { if (noState) throw new Error('ENOENT'); return JSON.stringify(recorded); } return ''; };
  const writeText = (file, text) => writes.push({ file, text });
  const checks = runChecks({ now, run, exists: () => true, mtimeMs: () => now, home: '/h', hourPt: 12, readText, writeText });
  return { calls, writes, check: checks.find(item => item.name === 'red-main') };
};

test('a red main run files one handoff issue naming the run, the commit and the failed jobs, then is remembered', () => {
  const first = recordFixture({ runs: [redRun(8), redRun(7, 'Verify', 'success')] });
  const create = first.calls.find(call => call[1] === 'issue' && call[2] === 'create');
  assert.ok(create, 'an issue is filed');
  const text = create.join(' ');
  assert.match(text, /Verify red on abcdef12 \(run 8\)/);
  assert.match(text, /lane:tooling/);
  assert.match(text, /handoff/);
  assert.match(create[create.indexOf('--body') + 1], /actions\/runs\/8/);
  assert.match(create[create.indexOf('--body') + 1], /scripts, 1\/6/);
  assert.deepEqual(JSON.parse(first.writes.at(-1).text), [8]);
  assert.match(first.check.detail, /issues\/9999/);
  const second = recordFixture({ runs: [redRun(8)], recorded: [8] });
  assert.equal(second.calls.filter(call => call[1] === 'issue' && call[2] === 'create').length, 0, 'the same run is never filed twice');
});

test('a red run followed by a green one is still recorded, and a failed filing is retried next hour', () => {
  const later = recordFixture({ runs: [redRun(9, 'Verify', 'success'), redRun(8)] });
  assert.equal(later.calls.filter(call => call[1] === 'issue' && call[2] === 'create').length, 1);
  assert.equal(later.check.status, 'ok', 'the newest run is green, so the check itself is not a warning');
  const failing = recordFixture({ runs: [redRun(8)], createFails: true });
  assert.equal(failing.writes.length, 0, 'nothing is remembered when filing failed');
  assert.equal(failing.check.status, 'warn');
  assert.match(failing.check.detail, /rerun or file/);
});

test('the first pass seeds the runs that are already red instead of filing an issue for old history', () => {
  const first = recordFixture({ runs: [redRun(8), redRun(7, 'Main full suite'), redRun(6, 'Verify', 'success')], noState: true });
  assert.equal(first.calls.filter(call => call[1] === 'issue' && call[2] === 'create').length, 0);
  assert.deepEqual(JSON.parse(first.writes.at(-1).text).sort(), [7, 8]);
});
