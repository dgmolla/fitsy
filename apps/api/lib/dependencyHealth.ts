import { randomUUID } from 'node:crypto';
import { authFetch } from '@fitsy/shared/utils/authTransport';
import { consumeSharedQuota } from '@/services/rateLimitStore';
import { prisma } from './restaurantService';

const TIMEOUT_MS = 2_000;

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
    upstash: async () => {
      const quota = await consumeSharedQuota({ namespace: 'health-readiness', windowMs: 1_000, max: 1, maxKeys: 1_000 }, randomUUID());
      if (!quota.ok) throw new Error('Store unavailable');
    },
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
