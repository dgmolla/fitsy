import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffSnapshot, fetchGitHub, fetchSlack, tick, readState } from './trigger.mjs';

const empty = { slackTs: '0', issues: {}, runs: [] };

test('a quiet tick reports nothing, and each item is reported once', () => {
  const snapshot = { slack: [{ ts: '10.1', text: 'alert' }], issues: [{ number: 990, title: 'incident', updatedAt: 'a', labels: ['incident'] }], runs: [{ id: 5, workflow: 'Deploy' }] };
  const first = diffSnapshot(snapshot, empty);
  assert.equal(first.items.length, 3);
  assert.equal(diffSnapshot(snapshot, first.next).items.length, 0);
  const updated = { ...snapshot, issues: [{ ...snapshot.issues[0], updatedAt: 'b' }] };
  assert.deepEqual(diffSnapshot(updated, first.next).items.map(item => item.source), ['issue']);
});

test('only the monitored failed workflows on main count, and issues are deduplicated across labels', () => {
  const calls = [];
  const run = (...args) => {
    calls.push(args.join(' '));
    if (args[0] === 'issue') return [{ number: 1, title: 't', updatedAt: 'x', labels: [{ name: 'incident' }, { name: 'P1' }] }];
    return [{ databaseId: 1, workflowName: 'Deploy', headSha: 's', url: 'u' }, { databaseId: 2, workflowName: 'Verify', headSha: 's', url: 'u' }];
  };
  const snapshot = fetchGitHub('o/r', run);
  assert.equal(snapshot.issues.length, 1);
  assert.deepEqual(snapshot.runs.map(item => item.workflow), ['Deploy']);
  assert.ok(calls.some(call => call.includes('--branch main')));
});

test('slack reads use the token privately and report API errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oncall-'));
  const envFile = join(dir, 'slack.env');
  writeFileSync(envFile, 'SLACK_BOT_TOKEN=xoxb-secret-value\n');
  try {
    const messages = await fetchSlack({ envFile, since: '5', fetchImpl: async (url, init) => {
      assert.match(url, /oldest=5/);
      assert.equal(init.headers.authorization, 'Bearer xoxb-secret-value');
      return { json: async () => ({ ok: true, messages: [{ ts: '6', text: 'hi' }] }) };
    } });
    assert.deepEqual(messages, [{ ts: '6', text: 'hi' }]);
    await assert.rejects(fetchSlack({ envFile, fetchImpl: async () => ({ json: async () => ({ ok: false, error: 'invalid_auth' }) }) }), /invalid_auth/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tick persists state, never leaks the token, and survives a slack failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oncall-'));
  const stateFile = join(dir, 'state.json');
  const github = () => ({ issues: [{ number: 7, title: 'x', updatedAt: 'u', labels: ['incident'] }], runs: [] });
  try {
    const result = await tick({ stateFile, github, slack: async () => { throw new Error('boom'); } });
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.errors, ['slack: boom']);
    assert.equal(readState(stateFile).issues[7], 'u');
    assert.equal((await tick({ stateFile, github, slack: async () => [] })).items.length, 0);
    assert.ok(!readFileSync(stateFile, 'utf8').includes('xoxb'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
