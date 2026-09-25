import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('local media lane applicability and source-bound receipt contract pass', () => {
  requireNodeSuite(resolve(__dirname, 'media-integration.test.mjs'), 2);
});
