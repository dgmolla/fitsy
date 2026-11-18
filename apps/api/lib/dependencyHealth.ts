import { authFetch } from '@fitsy/shared/utils/authTransport';
import { STORE_TIMEOUT_MS } from '@/services/rateLimitStore';
import { rateLimitStoreConfig } from '@/services/rateLimitStoreConfig';
import { prisma } from './restaurantService';

const TIMEOUT_MS = 2_000;

/**
 * Reachability and authentication probe for the shared store. PING is unbilled by Upstash and runs no script, so
 * frequent health checks do not spend the monthly command quota (#995). It does not prove the token can write;
 * the deployment preflight keeps exercising the writable EVAL path.
 */
export async function pingSharedStore(): Promise<void> {
  const { endpoint, token } = rateLimitStoreConfig();
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['PING']),
  });
  if (!response.ok) throw new Error('rate limit store HTTP error');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || 'error' in body || !('result' in body) || body.result !== 'PONG') {
    throw new Error('invalid rate limit store response');
  }
}

/** Bound pool acquisition too, not just query execution once a connection exists. */
export async function boundedHealthCheck<T>(check: () => PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(check), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Health check timeout')), TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

export async function deepHealth(): Promise<Record<'supabase' | 'upstash' | 'revenuecat', 'ok' | 'unavailable'>> {
  const checks = {
    supabase: () => prisma.$queryRaw`SELECT 1`,
    // #995: PING, not the billed sliding-window EVAL, so monitor traffic does not burn the Redis command quota.
    upstash: () => pingSharedStore(),
    revenuecat: async () => {
      const key = process.env['REVENUECAT_PUBLIC_API_KEY'];
      if (!key || (process.env['VERCEL_ENV'] === 'production' && key.startsWith('test_'))) throw new Error('RevenueCat unconfigured');
      // An unauthenticated request is deliberately rejected without creating a
      // synthetic customer, granting entitlements or reading account information.
      // The expected 401 proves API reachability, not webhook delivery or billing.
      const response = await authFetch('https://api.revenuecat.com/v1/subscribers/fitsy-health-probe', {
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status !== 401) throw new Error('RevenueCat unavailable');
    },
  };
  const results = await Promise.all(Object.entries(checks).map(async ([name, check]) => {
    try { await boundedHealthCheck(check); return [name, 'ok'] as const; }
    catch { return [name, 'unavailable'] as const; }
  }));
  return Object.fromEntries(results) as Awaited<ReturnType<typeof deepHealth>>;
}
