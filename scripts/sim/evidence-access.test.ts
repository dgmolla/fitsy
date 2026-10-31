import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('active entitlement setup validates genuine sandbox history and server access', () => {
  requireNodeSuite(resolve(__dirname, 'active-entitlement.test.mjs'));
});
test('screenshot and walkthrough content checks reject unintended expired screens', () => {
  requireNodeSuite(resolve(__dirname, 'screen-guard.test.mjs'));
});

if (process.env.FITSY_MEDIA_INTEGRATION === '1') {
  test('real native screenshot pixels pass through the installed OCR engine', () => {
    requireNodeSuite(resolve(__dirname, 'screen-guard.media.test.mjs'));
  });
}
