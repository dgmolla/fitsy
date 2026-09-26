import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport, formatReport, loadMainGates, loadMergedPulls, loadProject, postOnce,
} from './hourly-report.mjs';

const board = 'https://github.com/users/dgmolla/projects/1';
const now = new Date('2026-09-26T18:17:00Z');
const field = (name, value) => ({ field: { name }, ...(name === 'Status' || name === 'Priority' ? { name: value } : { text: value }) });
const item = (id, status = 'Queued') => ({ id,
  content: { __typename: 'Issue', number: id, title: `Issue ${id}`, url: `https://github.com/dgmolla/fitsy/issues/${id}`,
    labels: { nodes: [], pageInfo: { hasNextPage: false } } },
  fieldValues: { nodes: [field('Status', status)], pageInfo: { hasNextPage: false } } });

test('reads every project page and refuses incomplete fields or totals', async () => {
  const first = Array.from({ length: 100 }, (_, index) => item(index + 1));
  const query = async (_source, variables) => ({ user: { projectV2: { url: board,
    items: variables.after ? { totalCount: 101, nodes: [item(101)], pageInfo: { hasNextPage: false } } :
      { totalCount: 101, nodes: first, pageInfo: { hasNextPage: true, endCursor: 'next' } } } } });
  const result = await loadProject(query);
  assert.equal(result.items.length, 101);
  assert.equal(result.items.at(-1).content.number, 101);
  await assert.rejects(loadProject(async () => ({ user: { projectV2: { url: board,
    items: { totalCount: 2, nodes: [item(1)], pageInfo: { hasNextPage: false } } } } })), /Incomplete project read/);
  const partial = item(1); partial.fieldValues.pageInfo.hasNextPage = true;
  await assert.rejects(loadProject(async () => ({ user: { projectV2: { url: board,
    items: { totalCount: 1, nodes: [partial], pageInfo: { hasNextPage: false } } } } })), /more than 100 values/);
});

test('paginates closed PRs and counts merged PR numbers once', async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({ number: index + 1, base: { ref: 'main' },
    created_at: '2026-09-26T17:00:00Z', merged_at: '2026-09-26T18:00:00Z', updated_at: '2026-09-26T18:00:00Z' }));
  const calls = [];
  const result = await loadMergedPulls(async url => { calls.push(url); return url.endsWith('&page=1') ? first : [
    { ...first[0] }, { number: 101, base: { ref: 'main' }, created_at: '2026-09-26T17:00:00Z',
      merged_at: '2026-09-26T18:00:00Z', updated_at: '2026-09-26T18:00:00Z' },
  ]; }, now);
  assert.equal(calls.length, 2);
  assert.equal(result.length, 101);
});

test('keeps issue cycle, WIP age, PR throughput, and card counts separate', () => {
  const done = { id: 'done', content: { __typename: 'Issue', number: 1, title: 'Done', url: 'https://github.com/dgmolla/fitsy/issues/1' },
    fields: { Status: 'Done', 'Started at': '2026-09-26T16:00:00Z', 'Verified at': '2026-09-26T18:00:00Z' }, labels: [] };
  const missing = { ...done, id: 'missing', fields: { Status: 'Done' } };
  const active = { id: 'active', content: { __typename: 'Issue', number: 3, title: 'Ping <@U123> & all',
    url: 'https://github.com/dgmolla/fitsy/issues/3' }, fields: { Status: 'In flight', Priority: 'Now',
    'Started at': '2026-09-26T17:00:00Z', Progress: 'Building <@U123>', 'Next action': 'Review' }, labels: [] };
  const prCard = { id: 'pr', content: { __typename: 'PullRequest', number: 7 }, fields: { Status: 'Done' }, labels: [] };
  const queued = { ...active, id: 'queued', fields: { Status: 'Queued', Priority: 'Next' } };
  const pulls = [{ number: 7, base: { ref: 'main' }, created_at: '2026-09-26T17:00:00Z', merged_at: '2026-09-26T18:00:00Z' }];
  const report = buildReport({ url: board, items: [done, missing, active, prCard, queued] }, pulls,
    { sha: 'a'.repeat(40), state: 'green' }, now);
  assert.equal(report.prs24h.merged, 1);
  assert.equal(report.prs24h.medianMs, 3600000);
  assert.equal(report.issueCycle.sample, 1);
  assert.equal(report.issueCycle.missing, 1);
  assert.equal(report.wipAge.oldestMs, 77 * 60000);
  assert.equal(report.board.counts.Done, 3);
  assert.equal(report.board.next, 1);
  const text = formatReport(report);
  assert.match(text, /1 Next priority \(1 Queued total\)/);
  assert.match(text, /Verify \+ Deploy green/);
  assert.doesNotMatch(text, /<@U123>/);
  assert.ok(text.split('\n').length <= 10);
});

test('main gates require both exact-main workflows to succeed', async () => {
  const sha = 'b'.repeat(40);
  const rest = async url => url.endsWith('/commits/main') ? { sha } : { total_count: 2, workflow_runs: [
    { name: 'Verify', head_sha: sha, status: 'completed', conclusion: 'success', created_at: now.toISOString() },
    { name: 'Deploy', head_sha: sha, status: 'completed', conclusion: 'skipped', created_at: now.toISOString() },
  ] };
  assert.equal((await loadMainGates(rest)).state, 'pending');
  const green = await loadMainGates(async url => {
    const result = await rest(url);
    if (result.workflow_runs) result.workflow_runs[1].conclusion = 'success';
    return result;
  });
  assert.equal(green.state, 'green');
});

test('Slack history marker prevents duplicate posts and errors fail closed', async () => {
  const report = { hourKey: '2026-09-26T18' };
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => url.includes('history') ?
      { ok: true, messages: [{ text: 'fitsy-hour:2026-09-26T18' }] } : { ok: true, channel: 'C123', ts: '1.2' } };
  };
  assert.deepEqual(await postOnce(fake, 'token', 'C123', report, 'message'),
    { posted: false, duplicate: true, marker: 'fitsy-hour:2026-09-26T18' });
  assert.equal(calls.length, 1);
  await assert.rejects(postOnce(async () => ({ ok: true, status: 200,
    json: async () => ({ ok: false, error: 'missing_scope' }) }), 'token', 'C123', report, 'message'), /missing_scope/);
  const posting = await postOnce(async (url) => ({ ok: true, status: 200,
    json: async () => url.includes('history') ? { ok: true, messages: [] } :
      { ok: true, channel: 'C123', ts: '1.2' } }), 'token', 'C123', report, 'message');
  assert.equal(posting.posted, true);
  assert.equal(posting.ts, '1.2');
});
