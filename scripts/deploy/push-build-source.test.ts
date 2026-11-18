import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the build-source push guard and its refusal cases pass in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'push-build-source.test.mjs'));
});
