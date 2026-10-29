import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { trackSubscriptionCheck } from './analytics';
import { trackClientError } from './errorReporting';

const mockCapture = jest.fn();
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: jest.fn(() => ({ capture: mockCapture, flush: jest.fn(async () => {}) })),
}));

const originalEnv = process.env;
const runtime = globalThis as { __DEV__?: boolean };
const originalDev = runtime.__DEV__;
const originalConfig = Constants.expoConfig;
const originalChannel = Updates.channel;

afterEach(() => {
  process.env = originalEnv;
  if (originalDev === undefined) delete runtime.__DEV__;
  else runtime.__DEV__ = originalDev;
  Constants.expoConfig = originalConfig;
  Object.assign(Updates, { channel: originalChannel });
  jest.clearAllMocks();
});

test.each([
  ['production', 'https://fitsy.org', 'production', false, undefined],
  ['production', 'https://fitsy.org/', 'production', false, undefined],
  ['development', 'https://dev.fitsy.org', 'production', false, undefined],
  ['development', 'https://fitsy-api-candidate.vercel.app', 'production', false, undefined],
  ['development', 'https://fitsy.org', 'e2e', false, undefined],
  ['development', 'https://fitsy.org', 'preview', false, undefined],
  ['development', 'https://fitsy.org', null, false, undefined],
  ['development', 'https://fitsy.org', 'production', true, undefined],
  ['development', 'https://fitsy.org', 'production', false, 'localhost:8081'],
  ['development', 'https://fitsy.org.attacker.invalid', 'production', false, undefined],
  ['development', 'http://fitsy.org', 'production', false, undefined],
  ['development', undefined, 'production', false, undefined],
  ['development', 'malformed', 'production', false, undefined],
] as const)('both emitters classify %s for backend=%s channel=%s debug=%s host=%s', (kind, apiUrl, channel, debug, hostUri) => {
  process.env = { ...originalEnv, EXPO_PUBLIC_API_URL: apiUrl };
  runtime.__DEV__ = debug;
  Constants.expoConfig = { ...originalConfig!, hostUri };
  Object.assign(Updates, { channel });
  trackSubscriptionCheck({ source: 'status', outcome: 'server_error', status_code: 503, duration_ms: 1 });
  trackClientError({ source: 'global_handler', is_fatal: true, message: 'private-fixture' });
  expect(mockCapture).toHaveBeenCalledWith('subscription_check', expect.objectContaining({ kind }));
  expect(mockCapture).toHaveBeenCalledWith('client_error', { source: 'global_handler', is_fatal: true, kind });
});
