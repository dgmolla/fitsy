import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the hourly loop-check pass passes in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'loop-check.test.mjs'));
});
