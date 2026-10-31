import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('simulator classification, bounded replay and original evidence survive through the canonical suite', () => {
  requireNodeSuite(resolve(__dirname, 'failure-policy.test.mjs'));
});
