import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the on-call trigger dedupe and source handling pass in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'trigger.test.mjs'));
});
