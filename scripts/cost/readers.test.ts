import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the cost dashboard provider readers pass in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'readers.test.mjs'));
});
