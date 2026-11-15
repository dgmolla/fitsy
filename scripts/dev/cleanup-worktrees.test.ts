import { resolve } from 'node:path';
import { requireNodeSuite } from '../sim/node-suite-bridge';

test('worktree cleanup passes the Node ESM regression suite', () => {
  requireNodeSuite(resolve(__dirname, 'cleanup-worktrees.test.mjs'));
});
