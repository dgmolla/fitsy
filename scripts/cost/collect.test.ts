import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the cost collector with hand-entered figures passes in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'collect.test.mjs'));
});
