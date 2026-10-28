/* eslint-disable no-console -- Bounded telemetry diagnostics contain no request or provider data. */
import { after } from 'next/server';
import { getApiEmitter } from './apiEmitter';

const observedHandlers = new WeakSet<object>();

/** The route-discovery regression rejects new handlers that bypass monitoring. */
export function hasApiTelemetry(handler: unknown): boolean {
  return typeof handler === 'function' && observedHandlers.has(handler);
}

/** Preserve the handler's signature, response and thrown error exactly. */
export function withApiTelemetry<Args extends unknown[], Result extends Response>(
  method: string, route: string, handler: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  const observed = async (...args: Args): Promise<Result> => {
    const started = performance.now();
    let status = 500;
    try {
      const response = await handler(...args);
      status = response.status;
      return response;
    } finally {
      // Catch returned 5xx as well as throws. Never read headers, params or bodies.
      try {
        const sha = process.env['VERCEL_GIT_COMMIT_SHA'];
        const emitter = getApiEmitter();
        emitter.emitRequest({ method, route, status, alert: status >= 500,
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          environment: process.env['VERCEL_ENV'] ?? 'development',
          deploymentSha: sha && /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null,
        });
        if (emitter.enabled) {
          const flush = async () => {
            try { await emitter.flush(); }
            catch { console.error('[api-emitter] telemetry flush failed'); }
          };
          // Next keeps this work alive after sending the response on Vercel.
          // Direct handler invocations have no request scope (tests/local tools).
          try { after(flush); } catch { void flush(); }
        }
      } catch { console.error('[api-emitter] telemetry recording failed'); }
    }
  };
  observedHandlers.add(observed);
  return observed;
}
