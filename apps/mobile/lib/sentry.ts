import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { sanitizeCrashEvent } from '@fitsy/shared/utils/crashPrivacy';

/** JS-only until native events have an independently verified native privacy filter. */
export function initializeSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    release: `com.fitsy.mobile@${Constants.expoConfig?.version ?? 'development'}+${Constants.nativeBuildVersion ?? '0'}`,
    dist: Updates.updateId ?? Constants.nativeBuildVersion ?? 'embedded',
    environment: Updates.channel === 'testflight' ? 'testflight' :
      Updates.channel === 'production' ? 'production' : 'development',
    sendDefaultPii: false,
    sampleRate: 1,
    enableNative: false,
    enableNativeCrashHandling: false,
    autoInitializeNativeSdk: false,
    enableAutoSessionTracking: false,
    enableAutoPerformanceTracing: false,
    enableLogs: false,
    sendClientReports: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeCrashEvent,
    // Keep error handling, dedupe and stack rewriting only. No HTTP/device data.
    integrations: integrations => integrations.filter(integration =>
      ['ReactNativeErrorHandlers', 'Dedupe', 'RewriteFrames'].includes(integration.name)),
  });
}

export { captureException, wrap } from '@sentry/react-native';
