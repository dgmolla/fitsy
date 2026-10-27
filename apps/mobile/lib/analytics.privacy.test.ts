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

beforeEach(() => { sent.length = 0; __resetForTesting(); });

test('auth errors cannot transmit email, tokens or arbitrary error strings', () => {
  trackAuthFailure({ provider: 'apple', error_message: 'Authorization: Bearer secret-fixture alice@example.test' });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.event).toBe('auth_failure');
  expect(sent[0]!.properties).toEqual({ provider: 'apple' });
});

test('egress denies person profiles and unknown properties, even from a direct SDK caller', () => {
  const client = getPostHogClient();
  client.capture('$identify', { $set: { email: 'alice@example.test' } });
  client.capture('search_failed', {
    cuisine_filter: 'all', token: 'secret-fixture', latitude: 34.05,
    macro_calories: 1800, $set: { email: 'alice@example.test' },
  });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.properties).toEqual({ cuisine_filter: 'all' });
  expect(options).toMatchObject({
    disableGeoip: true, personProfiles: 'never', enableSessionReplay: false, captureAppLifecycleEvents: false,
  });
});

test('coarse operational search counts survive the privacy filter', () => {
  trackSearchPerformed({
    has_protein_target: true, has_carbs_target: false, has_fat_target: false, has_calories_target: true,
    cuisine_filter: 'all', query_length: 5, result_count: 10, location_source: 'gps', success: true,
  });
  expect(sent[0]!.properties).toMatchObject({ result_count: 10, query_length: 5, success: true });
});
