/**
 * JS-only crash/error reporting via PostHog (`client_error` events).
 *
 * Deliberately NOT a native crash SDK: the approved App Store binary predates
 * any native error module, and our OTA updates must stay runtime-compatible
 * with it. Native Sentry can land with the next binary; until then this
 * captures every JS-level failure (which in an Expo app is nearly every
 * failure users hit) with zero native surface.
 */
import { getPostHogClient } from './analytics';

const STACK_LIMIT = 4000;

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
      message: props.message,
      source: props.source,
      is_fatal: props.is_fatal,
      stack: props.stack?.slice(0, STACK_LIMIT) ?? '',
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
