import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the TestFlight post-submit transaction and refusal cases pass in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'testflight-post-submit.test.mjs'));
});
