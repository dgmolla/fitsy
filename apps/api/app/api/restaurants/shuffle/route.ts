import { NextRequest, NextResponse } from 'next/server';
import type { ShuffleResponse } from '@fitsy/shared';
import { getEntitlementStatus, optionalSubscription, syncSubscriptionFromRevenueCat } from '@/lib/subscription';
import { createRateLimiter } from '@/lib/rateLimit';
import { parseShuffleParams, type ShuffleParams } from '@/lib/shuffleParams';
import { ShuffleCache } from '@/lib/shuffleSelection';
import { findShuffle } from '@/lib/shuffleService';

const limiter = createRateLimiter({ windowMs: 60_000, max: 30 });
const cache = new ShuffleCache<ShuffleResponse>();
const headers = { 'Cache-Control': 'private, no-store' };
// A denied caller can need the bounded 8 s RevenueCat read plus cold-start/DB time.
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  let params: ShuffleParams;
  try { params = parseShuffleParams(request.nextUrl.searchParams); }
  catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400, headers });
  }
  try {
    // Always read the current verdict, including for cache hits and previously entitled callers.
    const subscription = await optionalSubscription(request);
    const { payload } = subscription;
    const principal = payload ? `user:${payload.sub}` : `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`;
    const limited = limiter.check(principal);
    if (!limited.ok) return NextResponse.json({ error: 'Too many requests' }, {
      status: 429, headers: { ...headers, 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) },
    });
    let { entitled } = subscription;
    if (payload && !entitled) {
      // Direct callers do not run the mobile purchase/sign-in sync first.
      // Repair missed webhooks, renewal gaps and earlier empty-account reads.
      await syncSubscriptionFromRevenueCat(payload.sub);
      // Re-read persisted proof: a newer webhook may have won, or the user was deleted.
      entitled = (await getEntitlementStatus(payload.sub, payload.email)).active;
    }
    const key = JSON.stringify([principal, entitled, params]);
    const cached = cache.get(key);
    if (cached) return NextResponse.json(cached, { headers });
    const started = Date.now();
    const response = await findShuffle(params, entitled, new Date(started));
    cache.set(key, response, started);
    return NextResponse.json(response, { headers });
  } catch (error) {
    console.error('[GET /api/restaurants/shuffle] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers });
  }
}
