import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('expired fixture preview targeting and purchase lifecycle run in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'expired-fixture.test.mjs'));
});
