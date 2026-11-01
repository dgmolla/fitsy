import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expiredScreen, testsExpiredScreen, inspectScreenshot, assertScreenCheck, inspectWalkthrough } from './screen-guard.mjs';
const expiredFlow = readFileSync(new URL('../../apps/mobile/e2e/flows/subscription-expired-routing.yaml', import.meta.url));
const ordinaryFlow = 'appId: com.fitsy.mobile\ntags: [billing]\n---\n- assertVisible: Search\n';

test('expired screen recognition covers text, wrapped OCR and native hierarchy without confusing sign-in', () => {
  for (const text of ['Your Fitsy Pro subscription\nended. Resubscribe to keep finding restaurants.',
    'Subscription ended', 'id="resubscribe-restore"', 'Welcome back. Resubscribe']) assert.equal(expiredScreen(text), true);
  for (const text of ['Welcome back. Sign in', 'Your trial ends in 14 days', 'Search restaurants or dishes'])
    assert.equal(expiredScreen(text), false);
});

test('only a maintained expired fixture with a mandatory visible expired-screen assertion can opt in', () => {
  assert.equal(testsExpiredScreen(expiredFlow), true);
  assert.equal(testsExpiredScreen(readFileSync(new URL('../../apps/mobile/e2e/flows/subscription-restore-expired.yaml', import.meta.url))), true);
  for (const source of [ordinaryFlow, '', expiredFlow.toString().replaceAll('fixture:expired-subscription', 'billing'),
    'tags: ["fixture:expired-subscription"]\n---\n- assertNotVisible: {id: resubscribe-restore}',
    'tags: ["fixture:expired-subscription"]\n---\n- assertVisible: {id: resubscribe-restore, optional: true}'])
    assert.equal(testsExpiredScreen(source), false);
});

test('capture fails on expired pixels, unreadable content and changed artifacts; intentional expiry remains valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-screen-policy-')), file = join(dir, 'screen.png');
  try {
    writeFileSync(file, 'fixture pixels');
    assert.throws(() => inspectScreenshot(file, ordinaryFlow, () => 'Your Fitsy Pro subscription ended'), /Unexpected/);
    assert.throws(() => inspectScreenshot(file, ordinaryFlow, () => ''), /could not be recognized/);
    const check = inspectScreenshot(file, ordinaryFlow, () => 'Search restaurants or dishes');
    assert.doesNotThrow(() => assertScreenCheck(check, readFileSync(file), ordinaryFlow));
    assert.throws(() => assertScreenCheck(check, Buffer.from('changed'), ordinaryFlow), /Missing, changed/);
    const expected = inspectScreenshot(file, expiredFlow, () => 'Your Fitsy Pro subscription ended');
    assert.doesNotThrow(() => assertScreenCheck(expected, readFileSync(file), expiredFlow));
    assert.throws(() => assertScreenCheck(expected, readFileSync(file), ordinaryFlow), /expired-screen/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('walkthroughs inspect actual screenshots and observations, without trusting expected prose or input commands', () => {
  const event = (name, content) => ({ command: { name }, result: { content } });
  const screen = event('take_screenshot', [{ type: 'image', mimeType: 'image/png', data: Buffer.from('pixels').toString('base64') }]);
  assert.throws(() => inspectWalkthrough([screen], ordinaryFlow, () => 'Subscription ended'), /Unexpected/);
  assert.doesNotThrow(() => inspectWalkthrough([screen], expiredFlow, () => 'Subscription ended'));
  assert.throws(() => inspectWalkthrough([event('inspect_view_hierarchy', [{ type: 'text', text: 'resubscribe-restore' }])]), /Unexpected/);
  assert.doesNotThrow(() => inspectWalkthrough([event('input_text', [{ type: 'text', text: 'Subscription ended' }])]));
});
