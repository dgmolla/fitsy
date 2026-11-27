import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the harness merge guard passes in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'harness-merge-guard.test.mjs'));
});
