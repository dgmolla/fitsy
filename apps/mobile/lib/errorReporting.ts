/**
 * Stack-free PostHog `client_error` counts for the existing pager.
 * Sentry separately captures sanitized crash stacks via lib/sentry.ts.
 */
import { getPostHogClient } from './analytics';
import { monitoringEnvironment } from './monitoringEnvironment';

export interface ClientErrorProps {
  message: string;
  stack?: string;
  source: 'global_handler' | 'error_boundary';
  is_fatal: boolean;
}

export function trackClientError(props: ClientErrorProps): void {
  try {
    const client = getPostHogClient();
    client.capture('client_error', {
      source: props.source,
      is_fatal: props.is_fatal,
      kind: monitoringEnvironment(),
    });
    // A fatal error may tear the app down before the periodic flush — push
    // the event out now, best-effort.
    void client.flush().catch(() => undefined);
  } catch {
    // Reporting must never make a crash worse.
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsShape {
  getGlobalHandler?: () => GlobalHandler | undefined;
  setGlobalHandler?: (handler: GlobalHandler) => void;
}

let installed = false;

/**
 * Wrap React Native's global JS error handler so uncaught errors reach
 * PostHog before the default handler (redbox in dev, crash in prod) runs.
 * Idempotent; safe to call from the root layout on every reload.
 */
export function installGlobalErrorReporting(): void {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const err = error instanceof Error ? error : new Error(String(error));
    trackClientError({
      message: err.message,
      stack: err.stack,
      source: 'global_handler',
      is_fatal: isFatal === true,
    });
    previous?.(error, isFatal);
  });
}

/** Test hook: allow re-installation within one JS context. */
export function _resetForTests(): void {
  installed = false;
}
