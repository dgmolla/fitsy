import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredBillingFixtures } from './publish-product-flow.mjs';

test('billing category defaults to the empty-store persona with no selected flows', () => {
  assert.deepEqual(requiredBillingFixtures({ categories: ['billing'], flows: [] }), ['empty-store']);
});

test('a selected flow tagged fixture:entitled-dev is included even without the billing category', () => {
  assert.deepEqual(requiredBillingFixtures({ categories: ['discovery'], flows: ['log-meal'] }), ['entitled-dev']);
});

test('a selected flow without a billing-relevant fixture tag contributes nothing', () => {
  assert.deepEqual(requiredBillingFixtures({ categories: ['discovery'], flows: ['onboarding-search-highlight'] }), []);
});

test('billing category plus an entitled-dev flow reports both personas, deduplicated and sorted', () => {
  assert.deepEqual(requiredBillingFixtures({ categories: ['billing', 'discovery'], flows: ['log-meal', 'map-search'] }),
    ['empty-store', 'entitled-dev']);
});
