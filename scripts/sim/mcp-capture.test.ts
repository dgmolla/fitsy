import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('MCP capture proxy and provenance pass the Node ESM regression suite', () => {
  requireNodeSuite(resolve(__dirname, 'mcp-capture.test.mjs'));
});
