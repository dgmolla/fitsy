import test from 'node:test';
import assert from 'node:assert/strict';
import { isCommandReceiptPath } from './product-flow.mjs';

// #864: a real pass was misreported as a hard failure because this matcher
// required a literal "commands-" prefix, but Maestro 2.12.1 writes a bare
// commands.json (confirmed via its own manifest.json COMMAND_METADATA entry).
test('isCommandReceiptPath matches both the bare and suffixed Maestro command-receipt filename', () => {
  assert.equal(isCommandReceiptPath('/evidence/chain-menu-serving/2026-11-14_011533/chain-menu-serving/commands.json'), true);
  assert.equal(isCommandReceiptPath('commands.json'), true);
  assert.equal(isCommandReceiptPath('/evidence/active-setup/commands-fixture.json'), true);
  assert.equal(isCommandReceiptPath('commands-1699999999.json'), true);
});

test('isCommandReceiptPath rejects unrelated files, including near-miss names', () => {
  assert.equal(isCommandReceiptPath('/evidence/manifest.json'), false);
  assert.equal(isCommandReceiptPath('/evidence/commands.jsonl'), false);
  assert.equal(isCommandReceiptPath('/evidence/precommands.json'), false);
  assert.equal(isCommandReceiptPath('/evidence/commands/report.json'), false);
});
