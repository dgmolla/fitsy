import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedRunSelection, resolveSelection, selectionFromReport } from './run-selection.mjs';

const waived = { skipBillingPersonas: false, skipBillingReason: 'Standing #888 walkthrough waiver', excludeFlows: [], waiveWalkthrough: true };
const none = { skipBillingPersonas: false, skipBillingReason: undefined, excludeFlows: [], waiveWalkthrough: false };

test('a run records only the validated selection, never extra fields', () => {
  const recorded = recordedRunSelection({ ...waived, apiKey: 'sk_secret', excludeFlows: ['a', 'b'] });
  assert.deepEqual(recorded, { skipBillingPersonas: false, skipBillingReason: 'Standing #888 walkthrough waiver', excludeFlows: ['a', 'b'], waiveWalkthrough: true });
  assert.equal(JSON.stringify(recorded).includes('sk_secret'), false);
});

test('finish, check and publish inherit the run selection when no flags are passed (#1092)', () => {
  assert.deepEqual(resolveSelection(none, waived), waived);
  assert.deepEqual(resolveSelection({}, { ...waived, skipBillingPersonas: true, excludeFlows: ['x'] }),
    { ...waived, skipBillingPersonas: true, excludeFlows: ['x'] });
});

test('explicit flags always win, so a waiver can still be applied later to an unwaived run', () => {
  assert.deepEqual(resolveSelection(waived, none), waived);
  assert.deepEqual(resolveSelection({ ...none, excludeFlows: ['y'], skipBillingReason: 'r' }, waived),
    { skipBillingPersonas: false, skipBillingReason: 'r', excludeFlows: ['y'], waiveWalkthrough: false });
});

test('nothing recorded and nothing passed keeps the walkthrough required', () => {
  assert.deepEqual(resolveSelection(none, undefined), none);
  assert.deepEqual(resolveSelection(none, null), none);
  assert.equal(resolveSelection(undefined, undefined).waiveWalkthrough, false);
});

test('a recorded waiver without a reason is not inherited as a waiver', () => {
  assert.equal(resolveSelection(none, { waiveWalkthrough: true }).waiveWalkthrough, false);
});

// The review of #1094 found that a stale report on disk could suppress required acceptance for a later candidate. A recorded selection is
// only inherited from a report that belongs to the current candidate: final-candidate mode, same source hash, a completed result, never preflight.
const goodReport = { evidenceMode: 'final-candidate', inputHash: 'abc', result: 'awaiting-walkthrough', runSelection: waived };

test('a recorded selection is only used from a final-candidate report for this exact candidate', () => {
  assert.deepEqual(selectionFromReport(goodReport, { currentInputHash: 'abc' }), waived);
  assert.deepEqual(selectionFromReport({ ...goodReport, result: 'pass' }, { currentInputHash: 'abc' }), waived);
  assert.equal(selectionFromReport(goodReport, { currentInputHash: 'other' }), undefined, 'a stale report for different sources is ignored');
  assert.equal(selectionFromReport({ ...goodReport, evidenceMode: 'development' }, { currentInputHash: 'abc' }), undefined);
  assert.equal(selectionFromReport({ ...goodReport, result: 'running' }, { currentInputHash: 'abc' }), undefined);
  assert.equal(selectionFromReport({ ...goodReport, result: 'fail' }, { currentInputHash: 'abc' }), undefined);
  assert.equal(selectionFromReport(goodReport, { currentInputHash: 'abc', preflight: true }), undefined, 'preflight never inherits');
  assert.equal(selectionFromReport(undefined, { currentInputHash: 'abc' }), undefined);
});

test('a stale report cannot suppress required acceptance: ignoring it keeps the walkthrough and every flow required', () => {
  const stale = selectionFromReport({ ...goodReport, runSelection: { ...waived, excludeFlows: ['every-flow'] } }, { currentInputHash: 'new-candidate' });
  assert.deepEqual(resolveSelection(none, stale), none);
});

// A source-level contract: the run records its selection, and finish, check and publish resolve it only through selectionFromReport. An
// end-to-end test would need a native run, so this guards against the wiring being dropped by a later edit.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('the run records its selection and finish, check and publish resolve it through selectionFromReport', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const flow = readFileSync(resolve(here, 'product-flow.mjs'), 'utf8');
  const publish = readFileSync(resolve(here, 'publish-product-flow.mjs'), 'utf8');
  assert.equal((flow.match(/runSelection: recordedRunSelection\(/g) || []).length, 2, 'both run report shapes record runSelection');
  assert.equal((flow.match(/selectionFromReport\(report, \{ currentInputHash: inputHash\(\) \}\)/g) || []).length, 2, 'finish and check use selectionFromReport');
  assert.match(publish, /selectionFromReport\(JSON\.parse\(readFileSync\(resolve\(evidenceDirectory, 'report\.json'\), 'utf8'\)\),\s*\{ currentInputHash: sourceHash\(\), preflight \}\)/);
  assert.doesNotMatch(flow + publish, /resolveSelection\([^)]*report\.runSelection\)/, 'no direct, unchecked use of report.runSelection');
});
