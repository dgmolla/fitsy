import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceMode, matchesFinalCandidate, runSelection } from './evidence-mode.mjs';

test('development is the default; recording requires an explicit run mode', () => {
  assert.deepEqual(runSelection(['device', 'billing']).mode, { name: 'development', recordVideo: false, publishable: false });
  assert.deepEqual(runSelection(['device', 'billing', '--mode=final-candidate']).names, ['billing']);
  assert.equal(runSelection(['device', '--mode=final-candidate']).mode.publishable, true);
  assert.equal(evidenceMode('requested-video').recordVideo, true);
  assert.equal(evidenceMode('requested-video').publishable, false);
  assert.throws(() => runSelection(['device', '--mode=development', '--mode=final-candidate']), /exactly one/);
  assert.throws(() => runSelection(['device', '--mode=unknown']), /Unknown evidence mode/);
});

test('a final candidate is reused only for the same passing source-bound selection', () => {
  const selected = { udid: 'device', appHash: 'app', configHash: 'config', backendDeployment: 'backend', fixture: 'fixture',
    flows: [{ name: 'welcome', sourceHash: 'source' }] };
  const report = { result: 'pass', evidenceMode: 'final-candidate', simulator: 'device', appHash: 'app', configHash: 'config',
    backendDeployment: 'backend', fixture: 'fixture', flows: [{ name: 'welcome', sourceHash: 'source' }] };
  assert.equal(matchesFinalCandidate(report, selected), true);
  const mismatches = [
    ['status', { result: 'fail' }],
    ['mode', { evidenceMode: 'development' }],
    ['simulator', { simulator: 'other' }],
    ['app hash', { appHash: 'other' }],
    ['configuration hash', { configHash: 'other' }],
    ['backend deployment', { backendDeployment: 'other' }],
    ['fixture', { fixture: 'other' }],
    ['flow count', { flows: [] }],
    ['flow name', { flows: [{ name: 'other', sourceHash: 'source' }] }],
    ['flow source hash', { flows: [{ name: 'welcome', sourceHash: 'other' }] }],
  ];
  for (const [field, change] of mismatches)
    assert.equal(matchesFinalCandidate({ ...report, ...change }, selected), false, field);
  assert.equal(matchesFinalCandidate(null, selected), false, 'missing report');
});
