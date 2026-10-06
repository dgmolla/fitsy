import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport, deliverySlot, formatReport, loadMainGates, loadMergedPulls, loadProject, postOnce,
  reportArtifact, projectFromSnapshot, collect, PROJECT_QUERY,
} from './hourly-report.mjs';

const board = 'https://github.com/users/dgmolla/projects/1';
const now = new Date('2026-09-26T18:17:00Z');
const field = (name, value) => ({ field: { name }, ...(name === 'Status' || name === 'Priority' ? { name: value } :
  name === 'Verified at' ? { date: value } : { text: value }) });
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
  const verified = item(102); verified.fieldValues.nodes.push(field('Verified at', '2026-09-26T18:00:00Z'));
  const parsed = await loadProject(async () => ({ user: { projectV2: { url: board,
    items: { totalCount: 1, nodes: [verified], pageInfo: { hasNextPage: false } } } } }));
  assert.equal(parsed.items[0].fields['Verified at'], '2026-09-26T18:00:00Z');
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
  const queued = { ...active, id: 'queued', content: { ...active.content, number: 4 },
    fields: { Status: 'Queued', Priority: 'Next' } };
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
  assert.match(text, /\*Fitsy 18:00 UTC\* · main green/);
  assert.doesNotMatch(text, /<@U123>/);
  const visible = text.replace(/<[^|>]+\|([^>]+)>/g, '$1').replace(/\*/g, '');
  assert.equal(visible.split('\n').length, 4);
  assert.ok(visible.split('\n').every(line => line.length <= 110));
  assert.match(text, /• \*Shipped:\* <https:\/\/github.com\/dgmolla\/fitsy\/issues\/1\|#1 Done>/);
  assert.match(text, /• \*Next:\* <https:\/\/github.com\/dgmolla\/fitsy\/issues\/3\|#3 Ping/);
  assert.match(text, /• \*Blocker:\* none/);
  assert.match(text, /#fitsy-slot:2026-09-26T18:00\|Details>/);
});

test('treats impossible calendar dates as missing issue evidence', () => {
  const done = { id: 'invalid', content: { __typename: 'Issue', number: 9 },
    fields: { Status: 'Done', 'Started at': '2026-02-30T16:00:00Z',
      'Verified at': '2026-03-03T18:00:00Z' }, labels: [] };
  const report = buildReport({ url: board, items: [done] }, [], { state: 'pending' }, now);
  assert.equal(report.issueCycle.sample, 0);
  assert.equal(report.issueCycle.missing, 1);
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
  const report = buildReport({ url: board, items: [] }, [], { state: 'green' }, now);
  const message = formatReport(report);
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => url.includes('history') ?
      { ok: true, messages: [{ text: message }] } : { ok: true, channel: 'C123', ts: '1.2' } };
  };
  assert.deepEqual(await postOnce(fake, 'token', 'C123', report, message),
    { posted: false, duplicate: true, marker: 'fitsy-slot:2026-09-26T18:00' });
  assert.equal(calls.length, 1);
  await assert.rejects(postOnce(async () => ({ ok: true, status: 200,
    json: async () => ({ ok: false, error: 'missing_scope' }) }), 'token', 'C123', report, message), /missing_scope/);
  await assert.rejects(postOnce(async () => ({ ok: true, status: 200,
    json: async () => ({ ok: true }) }), 'token', 'C123', report, message), /history messages unavailable/);
  const posting = await postOnce(async (url) => ({ ok: true, status: 200,
    json: async () => url.includes('history') ? { ok: true, messages: [] } :
      { ok: true, channel: 'C123', ts: '1.2' } }), 'token', 'C123', report, message);
  assert.equal(posting.posted, true);
  assert.equal(posting.ts, '1.2');
});

test('UTC half-hour slots stay distinct and reject stale fallback requests', () => {
  const early = new Date('2026-09-26T18:17:00Z');
  const late = new Date('2026-09-26T18:47:00Z');
  assert.equal(deliverySlot(early), '2026-09-26T18:00');
  assert.equal(deliverySlot(late), '2026-09-26T18:30');
  assert.equal(deliverySlot(new Date('2026-09-26T18:55:00Z'), '2026-09-26T18:30'),
    '2026-09-26T18:30');
  assert.notEqual(buildReport({ url: board, items: [] }, [], {}, early).slotKey,
    buildReport({ url: board, items: [] }, [], {}, late).slotKey);
  assert.throws(() => deliverySlot(late, '2026-09-26T18:17'), /invalid UTC delivery slot/);
  assert.throws(() => deliverySlot(late, '2026-09-26T19:00'), /future/);
  assert.throws(() => deliverySlot(late, '2026-09-26T17:30'), /stale/);
});

test('current and explicit recovery slots stay distinct after a delayed wake', () => {
  const project = { url: board, items: [] };
  const late = new Date('2026-09-26T21:58:00Z');
  const scheduled = buildReport(project, [], { state: 'green' }, late);
  const fallback = buildReport(project, [], { state: 'green' }, late, '2026-09-26T21:00');
  assert.equal(scheduled.slotKey, '2026-09-26T21:30');
  assert.equal(fallback.slotKey, '2026-09-26T21:00');
  assert.notEqual(scheduled.slotKey, fallback.slotKey);
});

test('repeated reports share one Slack marker per slot', async () => {
  const project = { url: board, items: [] };
  const first = buildReport(project, [], { state: 'green' }, new Date('2026-09-26T18:17:00Z'));
  const second = buildReport(project, [], { state: 'green' }, new Date('2026-09-26T18:47:00Z'));
  const fallback = buildReport(project, [], { state: 'green' },
    new Date('2026-09-26T18:55:00Z'), '2026-09-26T18:30');
  const messages = [];
  const fake = async (url, options) => {
    if (url.includes('conversations.history')) {
      const oldest = Number(new URL(url).searchParams.get('oldest'));
      return { ok: true, status: 200, json: async () => ({ ok: true,
        messages: messages.filter(entry => Number(entry.ts) >= oldest) }) };
    }
    const text = JSON.parse(options.body).text;
    const posted = { text, ts: String(Date.parse(`${text.includes(first.slotKey) ? first.slotKey : second.slotKey}:05Z`) / 1000) };
    messages.push(posted);
    return { ok: true, status: 200, json: async () => ({ ok: true, channel: 'C123', ts: posted.ts }) };
  };
  assert.equal((await postOnce(fake, 'token', 'C123', first, formatReport(first))).posted, true);
  assert.equal((await postOnce(fake, 'token', 'C123', second, formatReport(second))).posted, true);
  assert.deepEqual(await postOnce(fake, 'token', 'C123', fallback, formatReport(fallback)),
    { posted: false, duplicate: true, marker: 'fitsy-slot:2026-09-26T18:30' });
  assert.equal(messages.length, 2);
});

test('history pagination and an old hourly post prevent duplicate slot delivery', async () => {
  const report = buildReport({ url: board, items: [] }, [], { state: 'green' },
    new Date('2026-09-26T18:47:00Z'));
  const calls = [];
  const fake = async url => {
    calls.push(url);
    const cursor = new URL(url).searchParams.get('cursor');
    return { ok: true, status: 200, json: async () => ({ ok: true,
      messages: cursor ? [{ text: 'prior report #fitsy-hour:2026-09-26T18',
        ts: String(Date.parse('2026-09-26T18:40:00Z') / 1000) }] : [],
      response_metadata: cursor ? {} : { next_cursor: 'page2' } }) };
  };
  assert.deepEqual(await postOnce(fake, 'token', 'C123', report, formatReport(report)),
    { posted: false, duplicate: true, marker: 'fitsy-slot:2026-09-26T18:30' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.includes('conversations.history')));
  assert.equal(new URL(calls[0]).searchParams.get('oldest'),
    String(Date.parse('2026-09-26T18:30:00Z') / 1000));
});

test('legacy hourly marker from the next half-hour cannot suppress a recovered slot', async () => {
  const report = buildReport({ url: board, items: [] }, [], { state: 'green' },
    new Date('2026-09-26T18:55:00Z'), '2026-09-26T18:00');
  const methods = [];
  const fake = async url => {
    methods.push(url.includes('conversations.history') ? 'history' : 'post');
    return { ok: true, status: 200, json: async () => url.includes('conversations.history')
      ? { ok: true, messages: [{ text: 'fitsy-hour:2026-09-26T18',
        ts: String(Date.parse('2026-09-26T18:45:00Z') / 1000) }] }
      : { ok: true, channel: 'C123', ts: '123.456' } };
  };
  assert.equal((await postOnce(fake, 'token', 'C123', report, formatReport(report))).posted, true);
  assert.deepEqual(methods, ['history', 'post']);
});


test('keeps detailed review diagnostics out of the scan', () => {
  const report = buildReport({ url: board, items: [] }, [], { sha: 'a'.repeat(40), state: 'green' }, now);
  report.local = { phases: Object.fromEntries(['implementation', 'verification', 'unit', 'e2e', 'review', 'shipping'].map(phase =>
    [phase, { observedMs: null, cached: 0 }])), coverage: { active: 0, tracked: 0, stale: 0, invalid: 0 },
    rounds: [{ attempts: 1, running: 0 }, { attempts: 0, running: 0, cached: 3 }] };
  assert.doesNotMatch(formatReport(report), /review|round|cache reuse|median|WIP/);
});

test('compact copy shows gate state while detail retains measurements', () => {
  const report = buildReport({ url: board, items: [] }, [], { state: 'pending' }, now);
  report.local = { phases: Object.fromEntries(['implementation', 'verification', 'unit', 'e2e', 'review', 'shipping'].map(phase =>
    [phase, { observedMs: phase === 'e2e' ? null : 60000 }])),
  coverage: { active: 4, tracked: 3, stale: 2, invalid: 1 }, rounds: [] };
  let text = formatReport(report);
  assert.match(text, /main pending/);
  assert.doesNotMatch(text, /E2E|stale timing|missing timing|invalid timing/);
  report.main.state = 'failed';
  report.local.phases.e2e.observedMs = 120000;
  text = formatReport(report);
  assert.match(text, /main failed/);
  const artifact = JSON.parse(reportArtifact(report, { posted: false, dryRun: true }));
  assert.equal(artifact.local.phases.e2e.observedMs, 120000);
  assert.deepEqual(artifact.local.coverage, { active: 4, tracked: 3, stale: 2, invalid: 1 });
  assert.deepEqual(artifact.delivery, { posted: false, dryRun: true });
  assert.equal(text.split('\n').length, 4);
});

test('summary uses recent verified delivery and actionable board priority with bounded safe labels', () => {
  const card = (number, title, status, priority, verified, blocker = '') => ({
    id: String(number), content: { __typename: 'Issue', number, title,
      url: `https://github.com/dgmolla/fitsy/issues/${number}` },
    fields: { Status: status, Priority: priority, 'Verified at': verified, Blocker: blocker }, labels: [],
  });
  const cards = [
    card(1, 'Old done', 'Done', 'Now', '2026-09-24T18:00:00Z'),
    card(2, 'Merged but unverified', 'Done', 'Now', ''),
    card(3, 'Newest <@U123> *work* | continuation with a very long title', 'Done', 'Now', '2026-09-26T18:10:00Z'),
    { ...card(4, 'Second verified', 'Done', 'Now', '2026-09-26T18:00:00Z'),
      content: { __typename: 'Issue', number: 4, title: 'Second verified',
        url: 'https://github.com/dgmolla/other-repo/issues/4' } },
    card(5, 'Third verified', 'Done', 'Now', '2026-09-26T17:00:00Z'),
    card(6, 'Active work', 'In flight', 'Next', ''),
    card(7, 'Blocked now', 'Queued', 'Now', '', 'Waiting on credentials'),
    card(8, 'Ready now', 'Queued', 'Now', ''),
    card(9, 'Ready next', 'Queued', 'Next', ''),
    card(10, 'Blocked active', 'In flight', 'Now', '', 'Waiting on review'),
  ];
  const report = buildReport({ url: board, items: cards }, [], { state: 'green' }, now);
  assert.deepEqual(report.summary.shipped.map(issue => issue.number), [3, 4]);
  assert.deepEqual(report.summary.next.map(issue => issue.number), [6, 8]);
  assert.deepEqual(report.summary.blockers.map(issue => issue.number), [7]);
  const lines = formatReport(report).split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /#3 Newest &lt;@U123&gt; work \/ cont/);
  assert.match(lines[1], /<https:\/\/github.com\/dgmolla\/other-repo\/issues\/4\|#4 Second verified>/);
  assert.doesNotMatch(lines[1], /#1|#2|#5|<@U123>|\*work\*/);
  assert.match(lines[2], /#6 Active work.*#8 Ready now/);
  assert.doesNotMatch(lines[2], /#7|#9|#10/);
  assert.match(lines[3], /2 open.*#7 Blocked now/);
  const visible = lines.map(line => line.replace(/<[^|>]+\|([^>]+)>/g, '$1').replace(/\*/g, ''));
  assert.ok(visible.every(line => line.length <= 110));
});

 test('canonical complete snapshot suppresses publisher GraphQL and rejects partial or stale data', async () => {
  const snapshot = {observed_at:now.toISOString(),totalCount:1,items:[{
    id:'one',content:{type:'Issue',number:443,title:'Feature repair',url:'https://github.com/dgmolla/fitsy/issues/443'},
    labels:['dispatch-ready'],status:'Queued',priority:'Now',progress:'Repair',blocker:'',
    dependencies:'','next action':'Review','verified at':null,'started at':null,
  }]};
  const result = projectFromSnapshot(snapshot, now);
  assert.equal(result.items[0].fields.Status, 'Queued');
  assert.equal(result.items[0].content.__typename, 'Issue');
  assert.throws(() => projectFromSnapshot({...snapshot,totalCount:2}, now), /incomplete/);
  assert.throws(() => projectFromSnapshot({...snapshot,observed_at:'2026-09-26T17:00:00Z'}, now), /stale/);
  const incomplete = structuredClone(snapshot); delete incomplete.items[0].status;
  assert.throws(() => projectFromSnapshot(incomplete, now), /fields incomplete/);
  let graphql = 0;
  const fetcher = async url => {
    if (url.includes('/graphql')) { graphql++; throw new Error('publisher bypassed shared reader'); }
    const value = url.endsWith('/commits/main') ? {sha:'a'.repeat(40)} :
      url.includes('/actions/runs') ? {total_count:0,workflow_runs:[]} : [];
    return {ok:true,status:200,json:async () => value};
  };
  await collect(fetcher, 'fixture', 'fixture', now, undefined, [], snapshot);
  assert.equal(graphql, 0);
  // Query-shape reproduction only; this is not a measured live GitHub point cost.
  assert.match(PROJECT_QUERY, /fieldValues\(first: 100\)/);
 });
