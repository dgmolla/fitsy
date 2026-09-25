import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('publication artifact archive passes the Node ESM regression suite', () => {
  requireNodeSuite(resolve(__dirname, 'publication-artifacts.test.mjs'));
});
