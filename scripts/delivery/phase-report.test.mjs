import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTiming, loadTimings, summarizeTimings } from './phase-report.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const now = new Date('2026-09-26T20:00:00Z');
const event = (id, start = '18:00:00', end = '18:10:00') => ({ event_id: id, attempt_id: id,
  run_id: 'run1', issue: 355, phase: 'review', producer: 'review', round_id: 'a'.repeat(40),
  source_sha: 'a'.repeat(40), status: 'pass', started_at: `2026-09-26T${start}Z`,
  finished_at: `2026-09-26T${end}Z`, duration_ms: (Date.parse(`2026-09-26T${end}Z`) - Date.parse(`2026-09-26T${start}Z`)) });
const payload = events => ({ v: 1, issue: 355, run_id: 'run1', updated_at: now.toISOString(), events });
const comment = data => ({ author_association: 'OWNER', html_url: 'https://github.com/dgmolla/fitsy/issues/355#issuecomment-1',
  body: `<!-- fitsy-delivery:v1:run1 -->\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`` });

test('explicit local timing source fills an unpublished attempt without double counting a stale comment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-local-timing-'));
  try {
    mkdirSync(join(root, '.evidence/delivery'), { recursive: true });
    writeFileSync(join(root, '.evidence/delivery/binding.json'), JSON.stringify({ issue: 355, run_id: 'run1' }));
    const finished = { ...event('finished'), attempt_id: 'attempt1', source_sha: 'b'.repeat(40),
      started_at: '2026-09-26T18:00:00.000Z', finished_at: '2026-09-26T18:10:00.000Z' };
    const running = { ...finished, source_sha: 'a'.repeat(40), event_id: 'running', status: 'running',
      finished_at: null, duration_ms: null };
    writeFileSync(join(root, '.evidence/delivery/events.jsonl'), `${JSON.stringify(running)}\n${JSON.stringify(finished)}\n`);
    const items = [{ content: { __typename: 'Issue', number: 355 }, fields: { Status: 'In flight' } }];
    const unpublished = await loadTimings(async () => [], items, now, [root]);
    assert.equal(unpublished.phases.review.observedMs, 600000);
    assert.deepEqual(unpublished.evidence, [{ issue: 355, source: 'local' }]);
    const published = await loadTimings(async () => [comment(payload([running]))], items, now, [root]);
    assert.equal(published.phases.review.observedMs, 600000);
    assert.equal(published.phases.review.attempts, 1);
    const shard = { ...payload([{ ...finished, run_id: 'run1.p1' }]), run_id: 'run1.p1' };
    const shardedComment = comment(shard);
    shardedComment.body = shardedComment.body.replace('fitsy-delivery:v1:run1 -->',
      'fitsy-delivery:v1:run1.p1 -->');
    const sharded = await loadTimings(async () => [shardedComment], items, now, [root]);
    assert.equal(sharded.phases.review.attempts, 1);
    const mutated = comment(payload([{ ...finished, source_sha: 'c'.repeat(40) }]));
    await assert.rejects(loadTimings(async () => [mutated], items, now, [root]),
      /conflicts with published evidence/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only accepts valid writer observations for the exact issue/run', () => {
  const data = payload([event('a')]);
  assert.equal(parseTiming(comment(data), 355, +now).events.length, 1);
  assert.equal(parseTiming({ ...comment(data), author_association: 'NONE' }, 355, +now), null);
  assert.equal(parseTiming(comment(data), 356, +now), null);
  for (const changed of [
    { duration_ms: -1 }, { duration_ms: 0 }, { phase: 'invented' },
    { started_at: '2027-01-01T00:00:00Z' }, { finished_at: null }, { source_sha: 'fake' },
  ]) assert.equal(parseTiming(comment(payload([{ ...event('a'), ...changed }])), 355, +now), null);
  assert.equal(parseTiming(comment(payload([event('a'), event('a')])), 355, +now), null);
});

test('parallel review attempts preserve effort but do not double count wall time', () => {
  const events = [event('a'), event('b', '18:05:00', '18:15:00'),
    { ...event('c', '18:16:00', '18:16:00'), status: 'cached' },
    { ...event('d', '18:17:00', '18:19:00'), status: 'fail' },
    { ...event('e', '19:59:00', '19:59:00'), status: 'running', finished_at: null, duration_ms: null }];
  const result = summarizeTimings([{ issue: 355, active: true, runs: [payload(events)] }], now);
  assert.equal(result.phases.review.observedMs, 17 * 60000);
  assert.equal(result.rounds[0].lensMs, 22 * 60000);
  assert.equal(result.rounds[0].attempts, 3);
  assert.equal(result.phases.review.cached, 1);
  assert.equal(result.phases.review.failed, 1);
  assert.equal(result.phases.review.running, 1);
  assert.equal(result.phases.unit.observedMs, null);
  assert.equal(result.coverage.tracked, 1);
});

test('reads every comment page, rejects ambiguous duplicates, exposes missing and stale coverage', async () => {
  const items = [355, 356].map(number => ({ content: { __typename: 'Issue', number }, fields: { Status: 'In flight' } }));
  const observed = payload([event('a', '16:00:00', '16:10:00')]); observed.updated_at = '2026-09-26T17:00:00Z';
  const first = Array.from({ length: 99 }, () => ({ body: 'unrelated' }));
  const calls = [];
  const rest = async url => { calls.push(url); return url.includes('/356/') ? [] :
    url.endsWith('page=1') ? [...first, comment(observed)] : []; };
  const result = await loadTimings(rest, items, now);
  assert.equal(calls.length, 3);
  assert.deepEqual(result.coverage, { active: 2, tracked: 1, stale: 1, invalid: 0 });
  const duplicate = await loadTimings(async () => [comment(observed), comment(observed)], items.slice(0, 1), now);
  assert.equal(duplicate.phases.review.observedMs, null);
  assert.equal(duplicate.coverage.invalid, 1);
});

test('24h windows clip straddling work and do not treat cached/unfinished spans as measured', () => {
  const e = { ...event('a'), started_at: '2026-09-25T19:00:00Z', finished_at: '2026-09-25T21:00:00Z' };
  const result = summarizeTimings([{ issue: 355, active: true, runs: [payload([e])] }], now);
  assert.equal(result.phases.review.observedMs, 3600000);
});

test('fresh checkpoints retain unfinished attempts started before the window', () => {
  const e = { ...event('a'), started_at: '2026-09-25T18:00:00Z', finished_at: null,
    duration_ms: null, status: 'running' };
  const result = summarizeTimings([{ issue: 355, active: true, runs: [payload([e])] }], now);
  assert.equal(result.coverage.tracked, 1);
  assert.equal(result.phases.review.running, 1);
  assert.equal(result.phases.review.observedMs, null);
});

test('Done issues require valid verification dates inside the reporting window', async () => {
  for (const verified of ['2026-09-27T00:00:00Z', '2026-02-30T00:00:00Z', 'invalid']) {
    let reads = 0;
    await loadTimings(async () => { reads++; return []; }, [{ content: { __typename: 'Issue', number: 355 },
      fields: { Status: 'Done', 'Verified at': verified } }], now);
    assert.equal(reads, 0);
  }
});


test('historical observations count as tracked while stale stays separate', () => {
  const run = payload([{ ...event('old'), started_at: '2026-09-25T18:00:00Z', finished_at: '2026-09-25T18:10:00Z' }]);
  run.updated_at = '2026-09-25T18:10:00Z';
  const result = summarizeTimings([{ issue: 355, active: true, runs: [run] }], now);
  assert.deepEqual(result.coverage, { active: 1, tracked: 1, stale: 1, invalid: 0 });
  assert.equal(result.phases.review.observedMs, null);
});
