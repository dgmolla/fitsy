import { resolve } from 'node:path';
import { requireNodeSuite } from './node-suite-bridge';

test('evidence mode portable cases run in the canonical scripts suite', () => {
  requireNodeSuite(resolve(__dirname, 'evidence-mode.test.mjs'));
});

if (process.platform === 'darwin') {
  test('XCTest wrapper capture policy runs in the canonical macOS scripts suite', () => {
    requireNodeSuite(resolve(__dirname, 'evidence-mode.macos.test.mjs'));
  });
}
