import { initializeSentry } from './sentry';
import { sanitizeCrashEvent } from '@fitsy/shared/utils/crashPrivacy';
import * as Sentry from '@sentry/react-native';

jest.mock('@sentry/react-native', () => ({ init: jest.fn(), captureException: jest.fn(), wrap: jest.fn() }));

const originalDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
afterEach(() => {
  if (originalDsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = originalDsn;
  jest.clearAllMocks();
});

test('unconfigured installs are inert and configured installs use the privacy boundary', () => {
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  initializeSentry();
  expect(Sentry.init).not.toHaveBeenCalled();
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.test/1';
  initializeSentry();
  const options = jest.mocked(Sentry.init).mock.calls[0]?.[0];
  expect(options).toMatchObject({
    sendDefaultPii: false, enableNative: false, enableNativeCrashHandling: false, autoInitializeNativeSdk: false,
    enableAutoSessionTracking: false, enableAutoPerformanceTracing: false, enableLogs: false,
    maxBreadcrumbs: 0, sendClientReports: false, beforeSend: sanitizeCrashEvent,
  });
  expect(options).not.toHaveProperty('tracesSampleRate');
  expect(options).not.toHaveProperty('profilesSampleRate');
  expect(options).not.toHaveProperty('replaysOnErrorSampleRate');
  const candidates = ['ReactNativeErrorHandlers', 'Dedupe', 'RewriteFrames', 'HttpContext', 'DeviceContext', 'MobileReplay', 'FutureCollector'].map(name => ({ name }));
  const integrations = options?.integrations;
  expect(typeof integrations === 'function' ? integrations(candidates) : []).toEqual(candidates.slice(0, 3));
});
