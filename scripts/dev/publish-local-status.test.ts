import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the one-command product-flow publication helper passes in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'publish-local-status.test.mjs'));
});
