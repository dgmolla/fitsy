import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('XCTest attachment closeout passes the Node ESM regression suite', () => {
  requireNodeSuite(resolve(__dirname, 'xctest-attachments.test.mjs'));
}, 60_000);
