import { NextRequest, NextResponse } from 'next/server';
import { mobileFlags } from '@/lib/flags';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(mobileFlags(), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
