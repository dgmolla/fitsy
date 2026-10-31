/** @jest-environment node */
import type { CaptureEvent } from '@posthog/core';

const sent: CaptureEvent[] = [];
let options: Record<string, unknown>;
jest.mock('posthog-react-native', () => jest.fn().mockImplementation((_key, config) => {
  options = config;
  return {
    capture: (event: string, properties = {}) => {
      const candidate = { event, properties, distinct_id: 'anonymous-fixture' };
      const filtered = config.before_send ? config.before_send(candidate) : candidate;
      if (filtered) sent.push(filtered);
    },
    reset: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
  };
}));

import { __resetForTesting, getPostHogClient, trackAuthFailure, trackSearchPerformed } from './analytics';
import { sanitizeAnalyticsEvent } from './analyticsPrivacy';

beforeEach(() => { sent.length = 0; __resetForTesting(); });

test('auth errors cannot transmit email, tokens or arbitrary error strings', () => {
  trackAuthFailure({ provider: 'apple', error_message: 'Authorization: Bearer secret-fixture alice@example.test' });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.event).toBe('auth_failure');
  expect(sent[0]!.properties).toEqual({ provider: 'apple' });
});

test('egress denies unrequested SDK events and unknown properties, even from a direct SDK caller', () => {
  const client = getPostHogClient();
  client.capture('$create_alias', { alias: 'alice@example.test' });
  client.capture('search_failed', {
    cuisine_filter: 'all', token: 'secret-fixture', latitude: 34.05,
    macro_calories: 1800, $set: { email: 'alice@example.test' },
  });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.properties).toEqual({ cuisine_filter: 'all' });
  expect(options).toMatchObject({
    disableGeoip: true, personProfiles: 'identified_only', enableSessionReplay: false, captureAppLifecycleEvents: false,
  });
});

test.each(['$identify', '$set'])('%s permits only email as a person property', event => {
  const email = 'fixture@privaterelay.appleid.com';
  expect(sanitizeAnalyticsEvent({
    event,
    properties: { $anon_distinct_id: 'anonymous-fixture', latitude: 34.05, email, token: 'secret-fixture' },
    $set: { email, name: 'Private name', macro_calories: 1800, token: 'secret-fixture' },
    $set_once: { email: 'previous@example.test' },
  })).toEqual({
    event, properties: { $anon_distinct_id: 'anonymous-fixture' }, $set: { email },
  });
});

test('ordinary events cannot attach person properties', () => {
  expect(sanitizeAnalyticsEvent({
    event: 'auth_success', properties: { provider: 'apple', $anon_distinct_id: 'private-id' },
    $set: { email: 'fixture@example.test' }, $set_once: { name: 'Private name' },
  })).toEqual({ event: 'auth_success', properties: { provider: 'apple' } });
});

test.each(['', 'Bearer secret-fixture', 'alice@example.test\nprivate', 'x'.repeat(321), null])(
  'identification drops invalid email %p', email => {
    expect(sanitizeAnalyticsEvent({ event: '$identify', $set: { email } })?.$set).toBeUndefined();
  },
);

test('coarse operational search counts survive the privacy filter', () => {
  trackSearchPerformed({
    has_protein_target: true, has_carbs_target: false, has_fat_target: false, has_calories_target: true,
    cuisine_filter: 'all', query_length: 5, result_count: 10, location_source: 'gps', success: true,
  });
  expect(sent[0]!.properties).toMatchObject({ result_count: 10, query_length: 5, success: true });
});
