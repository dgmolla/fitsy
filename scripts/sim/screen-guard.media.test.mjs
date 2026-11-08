import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectScreenshot, recognizeScreen } from './screen-guard.mjs';

const expired = fileURLToPath(new URL('./fixtures/subscription-expired.png', import.meta.url));
const active = fileURLToPath(new URL('./fixtures/active-saved-meal.png', import.meta.url));
// Unedited #755 native failure capture at 90186445, SHA256 61ad4ec4b8e73bcc46436cdcaaa57b983bc647ddac32ca89dede0a1fdb7cc159.
const welcome = fileURLToPath(new URL('./fixtures/welcome-full-photo.png', import.meta.url));
const source = readFileSync(new URL('../../apps/mobile/e2e/flows/subscription-expired-routing.yaml', import.meta.url));

test('actual OCR rejects an unintended expired native capture', () => {
  assert.throws(() => inspectScreenshot(expired, ''), /Unexpected subscription-expired screenshot/);
});
test('actual OCR permits expiry only for the saved expired-screen journey', () => {
  assert.equal(inspectScreenshot(expired, source).expired, true);
});
test('actual OCR accepts an ordinary paid native capture', () => {
  assert.equal(inspectScreenshot(active, '').expired, false);
});
test('actual OCR and its publication caller recognize readable text over a native photo background', () => {
  assert.match(recognizeScreen(welcome), /Find meals that fit/i);
  const cli = fileURLToPath(new URL('./screen-guard.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, welcome], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).checks[0].expired, false);
});
test('the standalone publication caller fails on expired pixels and accepts an explicit expired journey', () => {
  const cli = fileURLToPath(new URL('./screen-guard.mjs', import.meta.url));
  const rejected = spawnSync(process.execPath, [cli, expired], { encoding: 'utf8' });
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, /Unexpected subscription-expired/);
  const accepted = spawnSync(process.execPath, [cli, expired,
    fileURLToPath(new URL('../../apps/mobile/e2e/flows/subscription-expired-routing.yaml', import.meta.url))], { encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).checks[0].expectedExpired, true);
});
