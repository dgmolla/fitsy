import { resolve } from 'node:path';
import { requireNodeSuite } from '../../sim/node-suite-bridge';

test('the daily memo script tests pass in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'daily-memo.test.mjs'));
});
