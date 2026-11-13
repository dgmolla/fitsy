import * as Sentry from '@sentry/nextjs';
import { sanitizeCrashEvent } from '@fitsy/shared/utils/crashPrivacy';

export const apiSentryOptions: Parameters<typeof Sentry.init>[0] = {
  dsn: process.env.SENTRY_DSN ?? '',
  release: `fitsy-api@${process.env.VERCEL_GIT_COMMIT_SHA ?? 'development'}`,
  dist: 'server',
  environment: process.env.VERCEL_ENV ?? 'development',
  sendDefaultPii: false,
  sampleRate: 1,
  enableLogs: false,
  sendClientReports: false,
  maxBreadcrumbs: 0,
  beforeBreadcrumb: () => null,
  beforeSend: sanitizeCrashEvent,
  // onRequestError supplies capture; no HTTP, DB, console, or session collectors.
  defaultIntegrations: false,
  skipOpenTelemetrySetup: true,
};

if (process.env.SENTRY_DSN) {
  Sentry.init(apiSentryOptions);
}
