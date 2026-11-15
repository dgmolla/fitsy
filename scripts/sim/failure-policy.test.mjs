import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFlowFailure, classifySimulatorFailure, collectFlowFailures, flowFailuresError, flowFailuresSummary, maestroFailure, withEnvironmentRetry } from './failure-policy.mjs';

test('only positive infrastructure evidence is classified as environment', () => {
  for (const message of ['kAXErrorInvalidUIElement', 'CoreSimulator service unavailable', 'ENOSPC', 'ECONNREFUSED', 'XCTest app hierarchy unavailable'])
    assert.equal(classifySimulatorFailure(new Error(message)), 'environment', message);
  for (const message of ['Assertion failed: Annual plan', 'Expected 7 days, got 2', 'HTTP 503', 'wall-deadline', 'unknown failure'])
    assert.equal(classifySimulatorFailure(new Error(message)), 'code', message);
  assert.equal(classifySimulatorFailure(maestroFailure('flow failed', { code: 1 }, { error: 'kAXErrorInvalidUIElement' })), 'environment');
  assert.equal(classifySimulatorFailure(maestroFailure('flow failed', { code: 1 }, { error: 'Element not found: Annual' })), 'code');
});

for (const [kind, outcomes, expectedCalls, passes] of [
  ['environment recovers', ['environment', 'pass'], 2, true],
  ['environment repeats', ['environment', 'environment'], 2, false],
  ['assertion', ['code', 'pass'], 1, false],
  ['retry finds assertion', ['environment', 'code', 'pass'], 2, false],
]) test(kind, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-failure-policy-'));
  let calls = 0;
  try {
    const run = withEnvironmentRetry(async evidence => {
      const outcome = outcomes[calls++];
      writeFileSync(join(evidence, 'raw.log'), outcome);
      if (outcome !== 'pass') throw maestroFailure('Maestro failed', { code: 1 }, {
        error: outcome === 'environment' ? 'kAXErrorInvalidUIElement' : 'Expected Monthly, found Annual',
      });
      return 'all assertions passed';
    }, { dir });
    if (passes) assert.equal(await run, 'all assertions passed');
    else await assert.rejects(run, /Maestro failed/);
    assert.equal(calls, expectedCalls);
    assert.equal(readFileSync(join(dir, 'raw.log'), 'utf8'), outcomes[0]);
    const receipt = JSON.parse(readFileSync(join(dir, 'attempts.json')));
    assert.equal(receipt.length, calls);
    assert.equal(receipt[0].classification, outcomes[0]);
    assert.equal(receipt[0].retry, calls === 2);
    if (calls === 2) assert.equal(readFileSync(join(dir, 'attempt-2/raw.log'), 'utf8'), outcomes[1]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const guard of ['changed-source', 'aborted', 'cleanup']) test(`no replay after ${guard}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-failure-guard-'));
  let calls = 0;
  try {
    await assert.rejects(withEnvironmentRetry(async () => {
      calls++;
      throw Object.assign(new Error('CoreSimulator unavailable'), { cleanupError: guard === 'cleanup' ? 'process still alive' : null });
    }, { dir, signal: { aborted: guard === 'aborted' }, canRetry: () => guard !== 'changed-source' }));
    assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const failAt = (stage, message) => Object.assign(new Error(message), { stage });

test('#888: flow failures are categorised by where they happened; infrastructure evidence wins', () => {
  assert.equal(classifyFlowFailure(failAt('preparation', 'Evidence login returned no account identity')), 'fixture');
  assert.equal(classifyFlowFailure(failAt('flow', 'Native flow log-meal failed')), 'flow');
  assert.equal(classifyFlowFailure(failAt('post-flow', 'Metro served a different bundle')), 'harness');
  assert.equal(classifyFlowFailure(new Error('unstamped failure')), 'flow');
  assert.equal(classifyFlowFailure(failAt('preparation', 'CoreSimulator service unavailable')), 'environment');
});

test('#888: one pass runs every flow and reports every failure with its category', async () => {
  const ran = [];
  const flows = ['a', 'b', 'c', 'd'].map(name => ({ name }));
  const collected = await collectFlowFailures(flows, async flow => {
    ran.push(flow.name);
    if (flow.name === 'b') throw failAt('preparation', 'fixture is stale');
    if (flow.name === 'd') throw failAt('flow', 'Assertion failed: Annual plan\nsecond line is dropped');
  });
  assert.deepEqual(ran, ['a', 'b', 'c', 'd'], 'a failing flow does not stop the rest');
  assert.deepEqual(collected.failures.map(item => [item.flow, item.classification]), [['b', 'fixture'], ['d', 'flow']]);
  assert.equal(collected.failures[1].summary, 'Assertion failed: Annual plan');
  assert.deepEqual(collected.notRun, []);
  const error = flowFailuresError(collected);
  assert.match(error.message, /2 flows failed:\n- b \[fixture\]: fixture is stale\n- d \[flow\]: Assertion failed: Annual plan/);
  assert.deepEqual(error.flowFailures, flowFailuresSummary(collected));
  assert.equal(JSON.stringify(error.flowFailures).includes('"error"'), false, 'the summary carries no Error objects');
});

test('#888: an environment failure stops the run and names the flows that did not run', async () => {
  const ran = [];
  const flows = ['a', 'b', 'c'].map(name => ({ name }));
  const collected = await collectFlowFailures(flows, async flow => {
    ran.push(flow.name);
    if (flow.name === 'a') throw failAt('flow', 'wrong text');
    if (flow.name === 'b') throw failAt('flow', 'CoreSimulator connection lost');
  });
  assert.deepEqual(ran, ['a', 'b']);
  assert.deepEqual(collected.failures.map(item => item.classification), ['flow', 'environment']);
  assert.deepEqual(collected.notRun, ['c']);
  assert.match(flowFailuresError(collected).message, /Not run after an environment failure: c/);
});

test('#888: a single failure keeps its original error so diagnostics and retry classification survive', async () => {
  const original = Object.assign(maestroFailure('flow failed', { code: 1, reason: 'wall-deadline' }, { error: 'Element not found' }), { stage: 'flow' });
  const collected = await collectFlowFailures([{ name: 'only' }], async () => { throw original; });
  assert.equal(flowFailuresError(collected), original);
  const clean = await collectFlowFailures([{ name: 'a' }, { name: 'b' }], async () => {});
  assert.deepEqual(clean, { failures: [], notRun: [] });
});
