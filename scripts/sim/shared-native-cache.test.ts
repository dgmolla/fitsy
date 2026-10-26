import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('shared immutable native cache and public build entrypoint regressions', () => {
  requireNodeSuite(resolve(__dirname, 'shared-native-cache.test.mjs'), undefined, 60_000);
}, 65_000);
