import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectScreenshot } from './screen-guard.mjs';

const expired = fileURLToPath(new URL('./fixtures/subscription-expired.png', import.meta.url));
const active = fileURLToPath(new URL('./fixtures/active-saved-meal.png', import.meta.url));
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
test('the standalone publication caller fails on expired pixels and accepts an explicit expired journey', () => {
  const cli = fileURLToPath(new URL('./screen-guard.mjs', import.meta.url));
  const rejected = spawnSync(process.execPath, [cli, expired], { encoding: 'utf8' });
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, /Unexpected subscription-expired/);
  const accepted = spawnSync(process.execPath, [cli, expired,
    fileURLToPath(new URL('../../apps/mobile/e2e/flows/subscription-expired-routing.yaml', import.meta.url))], { encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).checks[0].expectedExpired, true);
});
