import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyBillingPersonaSkip, billingPersonaFlowNames, checkCliArgs, requiredBillingFixtures, requiredStatusDescription } from './publish-product-flow.mjs';
import { billingSkipSelection } from './evidence-mode.mjs';

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

test('#862: applyBillingPersonaSkip also drops fixture:apple-history (a real Apple-sandbox build requirement, not a Test Store persona)', () => {
  const plan = { flows: ['subscription-restore-expired', 'onboarding-search-highlight'], required: true, categories: ['billing', 'onboarding'] };
  const result = applyBillingPersonaSkip(plan, { skipBillingPersonas: true, skipBillingReason: 'Dawit 5:07 PM PT Nov 13, #853' });
  assert.deepEqual(result, { plan: { flows: ['onboarding-search-highlight'], required: true, categories: ['billing', 'onboarding'] },
    skippedFlows: ['subscription-restore-expired'] });
});

test('#867: applyBillingPersonaSkip also drops explicitly named flows, for a failure unrelated to any billing persona', () => {
  const plan = { flows: ['cold-start-welcome', 'chain-menu-serving'], required: true, categories: ['onboarding', 'discovery'] };
  const result = applyBillingPersonaSkip(plan, { excludeFlows: ['cold-start-welcome'], skipBillingReason: 'Coordinator #867: unrelated auth flake' });
  assert.deepEqual(result, { plan: { flows: ['chain-menu-serving'], required: true, categories: ['onboarding', 'discovery'] },
    skippedFlows: ['cold-start-welcome'] });
});

test('#867: excludeFlows composes with skipBillingPersonas and ignores names absent from the plan', () => {
  const plan = { flows: ['cold-start-welcome', 'map-search', 'chain-menu-serving'], required: true, categories: ['billing', 'onboarding', 'discovery'] };
  const result = applyBillingPersonaSkip(plan, { skipBillingPersonas: true, excludeFlows: ['cold-start-welcome', 'never-selected'],
    skipBillingReason: 'both exclusions together' });
  assert.deepEqual(result.plan.flows, ['chain-menu-serving']);
  assert.deepEqual(result.skippedFlows, ['cold-start-welcome', 'map-search']);
});

test('#867: excludeFlows requires a reason, and a no-op exclusion changes nothing', () => {
  const plan = { flows: ['chain-menu-serving'], required: true, categories: ['discovery'] };
  assert.throws(() => applyBillingPersonaSkip(plan, { excludeFlows: ['chain-menu-serving'] }), /requires --reason/);
  assert.deepEqual(applyBillingPersonaSkip(plan, { excludeFlows: ['never-selected'], skipBillingReason: 'x' }),
    { plan, skippedFlows: [] });
});

test('#873: requiredStatusDescription shows the flow list and selection reason when both fit', () => {
  const plan = { flows: ['map-search', 'map-search-location-denied'],
    simulator: { reason: 'Mapped affected journeys from: apps/mobile/components/DiscoveryMap.tsx' } };
  const description = requiredStatusDescription(plan);
  assert.ok(description.length <= 140, description.length);
  assert.equal(description, '2 flow(s): map-search,map-search-location-denied - Mapped affected journeys from: apps/mobile/components/DiscoveryMap.tsx');
});

test('#873: requiredStatusDescription drops a too-long reason but keeps the flow list when the flow list alone still fits', () => {
  const plan = { flows: ['map-search', 'map-search-location-denied'],
    simulator: { reason: 'Shared UI or app shell requires the full smoke suite: apps/mobile/components/DiscoveryMap.tsx' } };
  const description = requiredStatusDescription(plan);
  assert.ok(description.length <= 140, description.length);
  assert.equal(description, '2 flow(s): map-search,map-search-location-denied');
});

test('#873: requiredStatusDescription falls back to a bare flow count for a large selection, never exceeding 140 characters', () => {
  const allFlows = Array.from({ length: 28 }, (_, i) => `onboarding-flow-number-${i}-with-a-long-descriptive-name`);
  const reason = 'Shared UI or app shell requires the full smoke suite: apps/mobile/components/ASignificantlyLongerComponentNameThatPushesThisReasonPastTheBudget.tsx';
  const plan = { flows: allFlows, simulator: { reason } };
  const description = requiredStatusDescription(plan);
  assert.ok(description.length <= 140, description.length);
  assert.equal(description, '28 flow(s) required');
});

test('#873: requiredStatusDescription appends the skip-note suffix and still respects the 140-character limit', () => {
  const plan = { flows: ['chain-menu-serving'], simulator: { reason: 'Mapped affected journeys from: apps/mobile/app/restaurant/[id].tsx' } };
  const withSuffix = requiredStatusDescription(plan, ' (skipped cold-start-welcome: Dawit 8:31 AM PT Nov 14, #866)');
  assert.ok(withSuffix.length <= 140, withSuffix.length);
  assert.match(withSuffix, /\(skipped cold-start-welcome: Dawit 8:31 AM PT Nov 14, #866\)$/);
  const hugeSuffix = requiredStatusDescription(plan, ` (skipped ${'x'.repeat(200)})`);
  assert.equal(hugeSuffix.length, 140);
});

test('#873: requiredStatusDescription tolerates a missing reason or empty flow list', () => {
  assert.equal(requiredStatusDescription({ flows: [] }), '0 flow(s) required');
  assert.equal(requiredStatusDescription({ flows: ['signin-options'] }), '1 flow(s): signin-options');
});

test('#883: checkCliArgs round-trips through billingSkipSelection exactly like run/finish parse the same flags', () => {
  for (const options of [
    {},
    { skipBillingPersonas: true, skipBillingReason: 'Dawit 5:07 PM PT Nov 13, #853' },
    { excludeFlows: ['cold-start-welcome'], skipBillingReason: 'Coordinator #867: unrelated auth flake' },
    { skipBillingPersonas: true, excludeFlows: ['cold-start-welcome', 'log-meal'], skipBillingReason: 'both exclusions together' },
  ]) {
    const args = checkCliArgs(options);
    const parsed = billingSkipSelection(args);
    assert.deepEqual(parsed.rest, []);
    assert.equal(parsed.skipBillingPersonas, Boolean(options.skipBillingPersonas));
    assert.deepEqual(parsed.excludeFlows, options.excludeFlows ?? []);
    assert.equal(parsed.skipBillingReason, options.skipBillingReason);
  }
});

test('#889: applyBillingPersonaSkip waives only the walkthrough and still requires every flow', () => {
  const plan = { flows: ['map-search', 'chain-menu-serving'], required: true, categories: ['billing', 'changed-journey'] };
  assert.throws(() => applyBillingPersonaSkip(plan, { waiveWalkthrough: true }), /requires --reason/);
  const { plan: waived, skippedFlows } = applyBillingPersonaSkip(plan, { waiveWalkthrough: true, skipBillingReason: 'Dawit #887' });
  assert.deepEqual(waived, { ...plan, waivedWalkthrough: true });
  assert.deepEqual(skippedFlows, []);
  assert.equal(applyBillingPersonaSkip(plan, {}).plan.waivedWalkthrough, undefined, 'never default-on');
  const both = applyBillingPersonaSkip(plan, { waiveWalkthrough: true, excludeFlows: ['map-search'], skipBillingReason: 'x' });
  assert.deepEqual(both.plan.flows, ['chain-menu-serving']);
  assert.equal(both.plan.waivedWalkthrough, true);
});

test('#889: checkCliArgs forwards --waive-walkthrough and round-trips through billingSkipSelection', () => {
  const args = checkCliArgs({ waiveWalkthrough: true, skipBillingReason: 'Dawit #887' });
  assert.deepEqual(args, ['--waive-walkthrough', '--reason', 'Dawit #887']);
  const parsed = billingSkipSelection(args);
  assert.equal(parsed.waiveWalkthrough, true);
  assert.equal(parsed.skipBillingReason, 'Dawit #887');
  assert.deepEqual(parsed.rest, []);
});
