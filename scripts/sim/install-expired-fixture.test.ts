import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('main-only adoption preserves the existing host entrypoint and fixture history', () => {
  requireNodeSuite(resolve(__dirname, 'install-expired-fixture.test.mjs'));
});
