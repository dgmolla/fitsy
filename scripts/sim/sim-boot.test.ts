import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('sim boot readiness and retry pass the Node ESM regression suite', () => {
  requireNodeSuite(resolve(__dirname, 'sim-boot.test.mjs'));
});
