import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the cost dashboard snapshot, alerts and page rendering pass in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'snapshot.test.mjs'));
});
