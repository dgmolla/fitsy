import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('native runner controls pass the Node ESM regression suite', () => {
  requireNodeSuite(resolve(__dirname, 'runner-controls.test.mjs'));
});
