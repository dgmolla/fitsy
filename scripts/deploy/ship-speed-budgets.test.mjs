import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BUDGETS, issueCommentHours, maestroQueueWaits, nativeAttemptsPerSha,
  openToMergeMinutes, pushesPerPr, verifyDurations, violations,
} from './ship-speed-budgets.mjs';

test('pushesPerPr reports each merged PR\'s commit count as its push count', () => {
  const prs = [{ number: 1, title: 'a', url: 'u1', commits: [{}, {}, {}] }, { number: 2, title: 'b', url: 'u2', commits: [{}] }];
  assert.deepEqual(pushesPerPr(prs), [{ pr: 1, title: 'a', url: 'u1', pushes: 3 }, { pr: 2, title: 'b', url: 'u2', pushes: 1 }]);
});

test('openToMergeMinutes computes the gap between createdAt and mergedAt', () => {
  const prs = [{ number: 1, title: 'a', url: 'u1', createdAt: '2026-11-10T10:00:00Z', mergedAt: '2026-11-10T10:30:00Z' }];
  assert.deepEqual(openToMergeMinutes(prs), [{ pr: 1, title: 'a', url: 'u1', minutes: 30 }]);
});

test('nativeAttemptsPerSha counts simulator runs grouped by head SHA, including re-runs', () => {
  const runs = [{ headSha: 'a' }, { headSha: 'a' }, { headSha: 'b' }];
  const result = nativeAttemptsPerSha(runs);
  assert.deepEqual(new Map(result.map(r => [r.sha, r.attempts])), new Map([['a', 2], ['b', 1]]));
});

test('maestroQueueWaits reads only the Maestro on Mac job, ignoring other jobs in the same run', () => {
  const runs = [{ databaseId: 1, headSha: 'a' }];
  const jobsFor = id => id === 1 ? [
    { name: 'select', created_at: '2026-11-10T10:00:00Z', started_at: '2026-11-10T10:00:01Z' },
    { name: 'Maestro on Mac', created_at: '2026-11-10T10:00:00Z', started_at: '2026-11-10T10:12:00Z' },
  ] : [];
  assert.deepEqual(maestroQueueWaits(runs, jobsFor), [{ run: 1, sha: 'a', queueWaitMinutes: 12 }]);
});

test('maestroQueueWaits skips a job missing timing fields (e.g. still queued)', () => {
  const runs = [{ databaseId: 1, headSha: 'a' }];
  const jobsFor = () => [{ name: 'Maestro on Mac', created_at: '2026-11-10T10:00:00Z', started_at: null }];
  assert.deepEqual(maestroQueueWaits(runs, jobsFor), []);
});

test('verifyDurations matches any Tests (L2) job including matrix-sharded names', () => {
  const runs = [{ databaseId: 1, headSha: 'a' }];
  const jobsFor = () => [
    { name: 'Tests (L2) (api)', started_at: '2026-11-10T10:00:00Z', completed_at: '2026-11-10T10:05:00Z' },
    { name: 'Tests (L2) (mobile)', started_at: '2026-11-10T10:00:00Z', completed_at: '2026-11-10T10:18:00Z' },
    { name: 'Build (L3)', started_at: '2026-11-10T10:00:00Z', completed_at: '2026-11-10T10:03:00Z' },
  ];
  assert.deepEqual(verifyDurations(runs, jobsFor), [
    { run: 1, sha: 'a', job: 'Tests (L2) (api)', durationMinutes: 5 },
    { run: 1, sha: 'a', job: 'Tests (L2) (mobile)', durationMinutes: 18 },
  ]);
});

test('issueCommentHours finds the busiest single hour, not the total comment count', () => {
  const issues = [{ number: 1, comments: [
    { createdAt: '2026-11-10T21:10:00Z' }, { createdAt: '2026-11-10T21:40:00Z' }, { createdAt: '2026-11-10T21:55:00Z' },
    { createdAt: '2026-11-10T23:05:00Z' },
  ] }];
  assert.deepEqual(issueCommentHours(issues), [{ issue: 1, peakCommentsPerHour: 3 }]);
});

test('issueCommentHours excludes comments before the lookback window', () => {
  const issues = [{ number: 1, comments: [{ createdAt: '2026-11-01T21:10:00Z' }, { createdAt: '2026-11-10T21:10:00Z' }] }];
  assert.deepEqual(issueCommentHours(issues, '2026-11-10'), [{ issue: 1, peakCommentsPerHour: 1 }]);
});

test('issueCommentHours reports zero for an issue with no comments', () => {
  assert.deepEqual(issueCommentHours([{ number: 1, comments: [] }]), [{ issue: 1, peakCommentsPerHour: 0 }]);
});

test('violations flags every metric that exceeds its budget and names the offender', () => {
  const metrics = {
    maestroQueueWaits: [{ run: 1, sha: 'a', queueWaitMinutes: 20 }],
    nativeAttemptsPerSha: [{ sha: 'a'.repeat(20), attempts: 3 }],
    verifyDurations: [{ run: 1, sha: 'a', job: 'Tests (L2)', durationMinutes: 25 }],
    pushesPerPr: [{ pr: 9, pushes: 9 }],
    issueCommentHours: [{ issue: 5, peakCommentsPerHour: 5 }],
  };
  const found = violations(DEFAULT_BUDGETS, metrics);
  assert.equal(found.length, 5);
  assert.match(found[0], /Maestro queue wait 20min > 15min/);
  assert.match(found[1], /3 native attempts > 2/);
  assert.match(found[2], /Tests \(L2\) took 25min > 20min/);
  assert.match(found[3], /PR #9 had 9 pushes > 8/);
  assert.match(found[4], /Issue #5 peaked at 5 comments\/hour > 4/);
});

test('violations is empty when every metric is within budget', () => {
  const metrics = {
    maestroQueueWaits: [{ run: 1, sha: 'a', queueWaitMinutes: 5 }],
    nativeAttemptsPerSha: [{ sha: 'a', attempts: 1 }],
    verifyDurations: [{ run: 1, sha: 'a', job: 'Tests (L2)', durationMinutes: 10 }],
    pushesPerPr: [{ pr: 1, pushes: 1 }],
    issueCommentHours: [{ issue: 1, peakCommentsPerHour: 1 }],
  };
  assert.deepEqual(violations(DEFAULT_BUDGETS, metrics), []);
});

test('CLI writes JSON and markdown to --out and exits nonzero on a violation', async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-ship-speed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'), out = join(dir, 'out');
  mkdirSync(bin); mkdirSync(out);
  const fakeGh = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'list') console.log(JSON.stringify([{ number: 1, title: 'x', createdAt: '2026-11-10T10:00:00Z', mergedAt: '2026-11-10T10:05:00Z', headRefOid: 'a', url: 'u' }]));
else if (args[0] === 'pr' && args[1] === 'view') console.log(JSON.stringify({ commits: Array.from({ length: 9 }, () => ({})) }));
else if (args[0] === 'run') console.log(JSON.stringify([]));
else if (args[0] === 'issue') console.log(JSON.stringify([]));
else { console.error('unexpected gh args: ' + args.join(' ')); process.exit(1); }
`;
  writeFileSync(join(bin, 'gh'), fakeGh, { mode: 0o755 });
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'ship-speed-budgets.mjs'), '--days=1', `--out=${out}`],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, timeout: 15000 });
  assert.equal(result.status, 1, result.stderr);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.status, 'fail');
  assert.match(parsed.summary, /1 budget violation/);
  const files = readFileSync(join(out, `budgets-${new Date().toISOString().slice(0, 10)}.json`), 'utf8');
  const report = JSON.parse(files);
  assert.equal(report.metrics.pushesPerPr[0].pushes, 9);
  assert.match(report.violations[0], /PR #1 had 9 pushes > 8/);
  const markdown = readFileSync(join(out, `budgets-${new Date().toISOString().slice(0, 10)}.md`), 'utf8');
  assert.match(markdown, /Ship-speed budgets/);
  assert.match(markdown, /PR #1 had 9 pushes/);
});

test('CLI --date overrides the output filename date, independent of generatedAt', async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-ship-speed-date-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'), out = join(dir, 'out');
  mkdirSync(bin); mkdirSync(out);
  const fakeGh = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'list') console.log(JSON.stringify([]));
else if (args[0] === 'run') console.log(JSON.stringify([]));
else if (args[0] === 'issue') console.log(JSON.stringify([]));
else { console.error('unexpected gh args: ' + args.join(' ')); process.exit(1); }
`;
  writeFileSync(join(bin, 'gh'), fakeGh, { mode: 0o755 });
  const result = spawnSync(process.execPath,
    [resolve(import.meta.dirname, 'ship-speed-budgets.mjs'), '--days=1', `--out=${out}`, '--date=2020-01-01'],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(out, 'budgets-2020-01-01.json')), true);
  assert.equal(existsSync(join(out, 'budgets-2020-01-01.md')), true);
});

test('CLI rejects a malformed --date', async () => {
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'ship-speed-budgets.mjs'), '--date=not-a-date'], { encoding: 'utf8', timeout: 5000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--date must be YYYY-MM-DD/);
});
