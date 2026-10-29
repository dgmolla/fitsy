import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/restaurantService';
import { widgetTokenHash } from '@/lib/widgetAuth';

const headers = { 'Cache-Control': 'private, no-store' };
// Renewed by the foreground app. No Supabase access or refresh token is shared.
const lifetimeMs = 30 * 24 * 60 * 60 * 1000;

async function installation(request: NextRequest): Promise<string | null> {
  try {
    const body = await request.json() as { installationId?: unknown };
    return typeof body.installationId === 'string' && /^[a-f0-9-]{36}$/.test(body.installationId)
      ? body.installationId : null;
  } catch { return null; }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const installationId = await installation(request);
  if (!installationId) return NextResponse.json({ error: 'Invalid installation ID' }, { status: 400, headers });
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + lifetimeMs);
  try {
    await prisma.widgetToken.upsert({
      where: { userId_installationId: { userId: auth.sub, installationId } },
      create: { userId: auth.sub, installationId, tokenHash: widgetTokenHash(token), expiresAt },
      update: { tokenHash: widgetTokenHash(token), expiresAt },
    });
    return NextResponse.json({ token, expiresAt: expiresAt.toISOString() }, { headers });
  } catch {
    return NextResponse.json({ error: 'Could not prepare widget' }, { status: 503, headers });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const installationId = await installation(request);
  if (!installationId) return NextResponse.json({ error: 'Invalid installation ID' }, { status: 400, headers });
  try {
    await prisma.widgetToken.deleteMany({ where: { userId: auth.sub, installationId } });
    return NextResponse.json({ revoked: true }, { headers });
  } catch {
    return NextResponse.json({ error: 'Could not revoke widget' }, { status: 503, headers });
  }
}
