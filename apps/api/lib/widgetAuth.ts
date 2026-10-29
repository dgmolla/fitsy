import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './restaurantService';
import { requireAuth } from './auth';
import type { JwtPayload } from '@/services/authService';
import { dataIpLimiter, dataUserLimiter, rateLimitResponse } from './rateLimit';
import { trustedClientIp } from './clientIp';

export const widgetTokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Capabilities work only at this read-only, unpaginated shuffle boundary. */
export async function requireWidgetSearchAuth(request: NextRequest): Promise<JwtPayload | NextResponse> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Widget ')) return requireAuth(request);
  const token = authorization.slice(7);
  const params = request.nextUrl.searchParams;
  const denied = () => NextResponse.json({ error: 'Unauthorized' }, {
    status: 401, headers: { 'Cache-Control': 'private, no-store' },
  });
  if (request.method !== 'GET' || request.nextUrl.pathname !== '/api/restaurants' ||
      !/^[a-f0-9]{64}$/.test(token) || params.get('shuffle') !== '1' || params.has('cursor')) return denied();
  const ipLimit = await dataIpLimiter.check(trustedClientIp(request));
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);
  const capability = await prisma.widgetToken.findUnique({
    where: { tokenHash: widgetTokenHash(token) }, include: { user: { select: { id: true, email: true } } },
  });
  if (!capability || capability.expiresAt.getTime() <= Date.now()) return denied();
  const payload = { sub: capability.user.id, email: capability.user.email };
  const userLimit = await dataUserLimiter.check(payload.sub);
  if (!userLimit.ok) return rateLimitResponse(userLimit);
  return payload;
}
