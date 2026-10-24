import { NextResponse } from 'next/server';
import { mobileFlags } from '@/lib/flags';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(mobileFlags(), {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
  });
}
