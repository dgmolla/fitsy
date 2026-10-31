import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifySimulatorFailure, maestroFailure, withEnvironmentRetry } from './failure-policy.mjs';

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
