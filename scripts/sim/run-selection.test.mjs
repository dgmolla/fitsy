import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedRunSelection, resolveSelection } from './run-selection.mjs';

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

// A source-level contract: finish, check and publish each resolve the run's recorded selection, and the run records it. An end-to-end test
// would need a native run, so this guards against the wiring being dropped by a later edit.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('the run records its selection and finish, check and publish resolve it', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const flow = readFileSync(resolve(here, 'product-flow.mjs'), 'utf8');
  const publish = readFileSync(resolve(here, 'publish-product-flow.mjs'), 'utf8');
  assert.equal((flow.match(/runSelection: recordedRunSelection\(/g) || []).length, 2, 'both run report shapes record runSelection');
  assert.equal((flow.match(/resolveSelection\(\s*\{ skipBillingPersonas[^}]*\}, report\.runSelection\)/g) || []).length, 2, 'finish and check resolve report.runSelection');
  assert.match(publish, /resolveSelection\(\s*\{ skipBillingPersonas[^}]*\}, recordedSelection\)/);
});
