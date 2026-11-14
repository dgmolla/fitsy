import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyBillingPersonaSkip, billingPersonaFlowNames, requiredBillingFixtures } from './publish-product-flow.mjs';

// journeyFixture requires FITSY_E2E_FIXTURES for any selected flow carrying a
// fixture tag (every real selected flow does), so build one real config per
// test with its own account per persona, matching what an operator sets up.
function withFixtures(t, entries) {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-billing-fixtures-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixtures = {};
  for (const [name, { email, password }] of Object.entries(entries)) {
    const envFile = join(dir, `${name}.env`);
    writeFileSync(envFile, `EXPO_PUBLIC_DEV_LOGIN_EMAIL=${email}\nEXPO_PUBLIC_DEV_LOGIN_PASSWORD=${password}\n`);
    fixtures[name] = { prepare: ['/bin/true'], envFile };
  }
  const configFile = join(dir, 'fixtures.json');
  writeFileSync(configFile, JSON.stringify({ version: 1, fixtures }));
  const previous = process.env.FITSY_E2E_FIXTURES;
  process.env.FITSY_E2E_FIXTURES = configFile;
  t.after(() => { if (previous === undefined) delete process.env.FITSY_E2E_FIXTURES; else process.env.FITSY_E2E_FIXTURES = previous; });
}

test('billing category checks the configured caller when no fixtures file exists at all', () => {
  assert.deepEqual(requiredBillingFixtures({ categories: ['billing'], flows: [] }), [{ name: 'empty-store', env: {} }]);
});

test('billing category prefers a configured fixtures file\'s own empty-store account over the (likely entitled) caller', t => {
  withFixtures(t, { 'empty-store': { email: 'empty@fitsy.dev', password: 'empty-pw' } });
  assert.deepEqual(requiredBillingFixtures({ categories: ['billing'], flows: [] }),
    [{ name: 'empty-store', env: { EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'empty@fitsy.dev', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'empty-pw' } }]);
});

test('a selected flow tagged fixture:entitled-dev resolves its own configured account, not the canonical login', t => {
  withFixtures(t, { 'entitled-dev': { email: 'entitled@fitsy.dev', password: 'entitled-pw' } });
  assert.deepEqual(requiredBillingFixtures({ categories: ['discovery'], flows: ['log-meal'] }),
    [{ name: 'entitled-dev', env: { EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'entitled@fitsy.dev', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'entitled-pw' } }]);
});

test('a selected flow tagged with a non-billing fixture contributes nothing and never requires that fixture to be configured', () => {
  assert.deepEqual(requiredBillingFixtures({ categories: ['discovery'], flows: ['onboarding-search-highlight'] }), []);
});

test('billing category plus an entitled-dev flow reports both personas, each with its own distinct account', t => {
  withFixtures(t, {
    'entitled-dev': { email: 'entitled@fitsy.dev', password: 'entitled-pw' },
    'empty-store': { email: 'empty@fitsy.dev', password: 'empty-pw' },
  });
  const result = requiredBillingFixtures({ categories: ['billing', 'discovery'], flows: ['log-meal', 'map-search'] });
  assert.deepEqual(result, [
    { name: 'empty-store', env: { EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'empty@fitsy.dev', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'empty-pw' } },
    { name: 'entitled-dev', env: { EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'entitled@fitsy.dev', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'entitled-pw' } },
  ]);
  // The regression this guards: empty-store and entitled-dev cannot be the
  // same account, so their resolved overrides must differ.
  assert.notDeepEqual(result[0].env, result[1].env);
});

test('billingPersonaFlowNames finds only the flows tagged for a named persona', () => {
  assert.deepEqual(billingPersonaFlowNames({ flows: ['map-search', 'map-search-location-denied', 'onboarding-search-highlight'], required: true },
    ['entitled-dev']), ['map-search', 'map-search-location-denied']);
  assert.deepEqual(billingPersonaFlowNames({ flows: ['onboarding-search-highlight'], required: true }, ['entitled-dev', 'expired-subscription']), []);
});

test('applyBillingPersonaSkip is a no-op when not requested, even if billing flows are selected', () => {
  const plan = { flows: ['map-search', 'onboarding-search-highlight'], required: true, categories: ['billing', 'discovery'] };
  assert.deepEqual(applyBillingPersonaSkip(plan, {}), { plan, skippedFlows: [] });
  assert.deepEqual(applyBillingPersonaSkip(plan), { plan, skippedFlows: [] });
});

test('applyBillingPersonaSkip requires a non-empty reason whenever requested', () => {
  const plan = { flows: ['map-search'], required: true };
  assert.throws(() => applyBillingPersonaSkip(plan, { skipBillingPersonas: true }), /requires --reason/);
  assert.throws(() => applyBillingPersonaSkip(plan, { skipBillingPersonas: true, skipBillingReason: '  ' }), /requires --reason/);
});

test('applyBillingPersonaSkip drops only the billing-tagged flows, keeping every other flow required', () => {
  const plan = { flows: ['map-search', 'onboarding-search-highlight'], required: true, categories: ['billing', 'discovery'] };
  const result = applyBillingPersonaSkip(plan, { skipBillingPersonas: true, skipBillingReason: 'Dawit 5:07 PM PT Nov 13, #853' });
  assert.deepEqual(result, { plan: { flows: ['onboarding-search-highlight'], required: true, categories: ['billing', 'discovery'] }, skippedFlows: ['map-search'] });
});

test('applyBillingPersonaSkip flips required to false when every selected flow was billing-gated (#834)', () => {
  const plan = { flows: ['map-search', 'map-search-location-denied'], required: true, categories: ['billing', 'discovery', 'changed-journey'] };
  const result = applyBillingPersonaSkip(plan, { skipBillingPersonas: true, skipBillingReason: 'Dawit 5:07 PM PT Nov 13, #853' });
  assert.deepEqual(result.plan.flows, []);
  assert.equal(result.plan.required, false);
  assert.deepEqual(result.skippedFlows, ['map-search', 'map-search-location-denied']);
});

test('applyBillingPersonaSkip changes nothing when requested but no selected flow is billing-tagged', () => {
  const plan = { flows: ['onboarding-search-highlight'], required: true, categories: ['discovery'] };
  assert.deepEqual(applyBillingPersonaSkip(plan, { skipBillingPersonas: true, skipBillingReason: 'no billing surface' }),
    { plan, skippedFlows: [] });
});
