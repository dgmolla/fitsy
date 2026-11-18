import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the external-config drift check passes in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'check-external-config.test.mjs'));
});
