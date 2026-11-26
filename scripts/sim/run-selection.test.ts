import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('the run selection tests pass in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'run-selection.test.mjs'));
});
