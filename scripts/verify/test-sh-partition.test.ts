import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('the scripts test partition contract (--shard passthrough, invalid values rejected) passes in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'test-sh-partition.test.mjs'), 6, 180_000);
});
