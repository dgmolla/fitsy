import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { sanitizeCrashEvent } from '@fitsy/shared/utils/crashPrivacy';

/**
 * Native crash capture enabled (Dawit, 2026-11-13, after #832's native
 * NSRangeException would have been missed by JS-only Sentry). `beforeSend`
 * and `beforeBreadcrumb` do not run for native crash events - the native SDK
 * strips JS-only callbacks before it starts, and a native crash is captured
 * and transported by the native layer before the JS engine (and this
 * `sanitizeCrashEvent` allowlist filter) ever sees it. This is a documented,
 * verified SDK limitation (not something a config option can close), so
 * native crash reports carry Sentry's standard native crash payload (device
 * model/OS/app version, native stack trace and binary images) instead of the
 * strict JS allowlist below. `sendDefaultPii: false` still applies natively
 * and suppresses IP/user-identifying data there too; attachments, screenshots
 * and view-hierarchy capture stay off explicitly rather than relying on SDK
 * defaults. No `setUser`/`setContext`/`setTag` call exists anywhere in this
 * app, so there is no app-specific user data for a native crash to carry.
 */
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
    enableNative: true,
    enableNativeCrashHandling: true,
    autoInitializeNativeSdk: true,
    attachScreenshot: false,
    attachViewHierarchy: false,
    attachThreads: false,
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
