import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, nativeRunInFlight } from './harness-merge-guard.mjs';

test('holds a journey-affecting merge only while a native run is in flight', () => {
  const files = ['scripts/sim/product-flow.mjs'];
  assert.equal(decide(files, 'simulator lock held', () => ({ scope: 'full' })).hold, true);
  assert.equal(decide(files, null, () => ({ scope: 'full' })).hold, false);
  assert.equal(decide(['docs/x.md'], 'simulator lock held', () => ({ scope: 'none' })).hold, false);
});

test('reports no run when there is no lock and pgrep matches nothing', () => {
  const exec = () => { throw new Error('exit 1'); };
  assert.equal(nativeRunInFlight({ lockPath: '/nonexistent/simulator.lock', exec }), null);
  assert.match(nativeRunInFlight({ lockPath: '/nonexistent/x', exec: () => '123 node scripts/sim/product-flow.mjs\n' }), /collector running/);
});
