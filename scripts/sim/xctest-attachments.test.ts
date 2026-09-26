import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('XCTest attachment closeout passes the Node ESM regression suite', () => {
  requireNodeSuite(resolve(__dirname, 'xctest-attachments.test.mjs'),
    process.env.FITSY_MEDIA_INTEGRATION === '1' ? 10 : 2);
}, 60_000);
