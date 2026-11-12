import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { analyticsAccount, analyticsDistribution } from './analyticsContext';

const env = process.env;
const runtime = globalThis as { __DEV__?: boolean };
const dev = runtime.__DEV__;
const config = Constants.expoConfig;
const channel = Updates.channel;
afterEach(() => {
  process.env = env; runtime.__DEV__ = dev; Constants.expoConfig = config;
  Object.assign(Updates, { channel });
});

test.each([
  ['testflight', 'https://fitsy.org', false, 'testflight', false],
  ['production', 'https://fitsy.org', false, 'production', false],
  ['testflight', 'https://dev.fitsy.org', false, 'testflight', true],
  ['testflight', 'https://fitsy.org', true, 'development', true],
  ['e2e', 'https://fitsy.org', false, 'development', true],
  [null, 'invalid', false, 'unknown', true],
] as const)('separates channel=%s backend=%s debug=%s from staff eligibility', (ota, api, debug, distribution, internal) => {
  Object.assign(Updates, { channel: ota }); runtime.__DEV__ = debug;
  Constants.expoConfig = { ...config!, hostUri: undefined };
  process.env = { ...env, EXPO_PUBLIC_API_URL: api };
  expect(analyticsDistribution()).toBe(distribution);
  expect(analyticsAccount({ id: 'account', user_metadata: { neighborhood: 'DTLA' } }))
    .toEqual({ la_cohort: true, $internal_or_test_user: internal });
  expect(analyticsAccount({ id: 'account', user_metadata: { fitsy_internal_or_test: true } }))
    .toEqual({ la_cohort: true, $internal_or_test_user: true });
});
