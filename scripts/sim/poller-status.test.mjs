import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attemptOutcome, finishSimulatorAttempt, postSimulatorStatus, statusDescription } from './poller-status.mjs';

const head = 'a'.repeat(40);
test('assertion failures retain their reason and infrastructure timeouts get exactly one retry', () => {
  for (const [error, status] of [[Object.assign(new Error('saved-content is not visible'), { gateFail: true }), 'failure'],
    [Object.assign(new Error('maestro exceeded its deadline'), { code: 'ETIMEDOUT' }), 'error']]) {
    const first = attemptOutcome({ head, tries: 0, scope: 'full', error });
    assert.equal(first.status, status); assert.equal(first.retry, true); assert.equal(first.tries, 1);
    assert.ok(first.description.includes(error.message));
    const second = attemptOutcome({ head, tries: first.tries, scope: 'full', error });
    assert.equal(second.status, status); assert.equal(second.retry, false); assert.equal(second.tries, 2);
    if (status === 'error') assert.match(second.description, /timed out/);
  }
});

test('blank, multiline and secret-bearing failures remain bounded and actionable', () => {
  const empty = attemptOutcome({ head, tries: 0, scope: 'full', error: new Error('\n  ') });
  assert.match(empty.description, /Runner error without a description/);
  const secret = 'fixture-secret-password';
  const failure = attemptOutcome({ head, tries: 0, error: new Error(`\nlogin failed ${secret}\n${'x'.repeat(500)}`), env: { PASSWORD: secret } });
  assert.ok(failure.description.length <= 140);
  assert.ok(!failure.reason.includes(secret)); assert.ok(!failure.description.includes('\n'));
  assert.match(statusDescription('error', ''), /without a description/);
  assert.throws(() => statusDescription('success', ''), /nonempty/);
  assert.equal(attemptOutcome({ head, tries: 0, verdict: {} }).status, 'error');
});

test('status publication records GitHub acknowledgment bound to the head, state and reason', () => {
  const receipts = [];
  const result = postSimulatorStatus((path, method, body) => {
    assert.equal(path, `statuses/${head}`); assert.equal(method, 'POST');
    assert.equal(body.context, 'Simulator'); assert.match(body.description, /without a description/);
    return { id: 321, ...body };
  }, head, 'error', '', value => receipts.push(JSON.parse(value)));
  assert.equal(result.id, 321);
  assert.deepEqual(receipts, [{ type: 'simulator-status-posted', head, id: 321, state: 'error', description: result.description }]);
  for (const response of [null, {}, { id: 1, state: 'success', context: 'Simulator', description: 'failed' }])
    assert.throws(() => postSimulatorStatus(() => response, head, 'error', 'failed'), /did not acknowledge/);
});

test('a failed status write replays publication without consuming another native attempt or erasing history', () => {
  const evidence = mkdtempSync(join(tmpdir(), 'fitsy-status-'));
  try {
    const state = { tries: 0 };
    let persisted;
    const save = () => { persisted = structuredClone(state); };
    assert.throws(() => finishSimulatorAttempt({ state, head, scope: 'full', error: new Error('backend unavailable'),
      evidence, post: () => { throw new Error('GitHub offline'); }, save }), /GitHub offline/);
    assert.equal(persisted.final, undefined); assert.equal(persisted.tries, 1);
    assert.match(persisted.pendingStatus.description, /backend unavailable/);
    const post = (_head, status, description) => { assert.equal(status, 'error'); assert.match(description, /backend unavailable/); };
    finishSimulatorAttempt({ state, head, post, save });
    assert.equal(state.tries, 1); assert.equal(state.final, undefined); assert.equal(state.pendingStatus, undefined);
    assert.equal(readFileSync(join(evidence, 'attempts.jsonl'), 'utf8').trim().split('\n').length, 1);
    finishSimulatorAttempt({ state, head, scope: 'full', error: new Error('backend unavailable'), evidence, post, save });
    assert.equal(state.tries, 2); assert.equal(state.final, 'error');
    assert.equal(readFileSync(join(evidence, 'attempts.jsonl'), 'utf8').trim().split('\n').length, 2);
    state.pendingStatus = { head: 'b'.repeat(40) };
    assert.throws(() => finishSimulatorAttempt({ state, head, post, save }), /another head/);
  } finally { rmSync(evidence, { recursive: true, force: true }); }
});
