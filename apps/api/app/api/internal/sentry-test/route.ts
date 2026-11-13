import { withApiTelemetry } from '@/lib/apiTelemetry';
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/sentry-test - one-shot Sentry pipeline verification (#747).
 *
 * Throws the constant synthetic error so Next's onRequestError hook calls
 * Sentry.captureRequestError exactly like a real unhandled 500, proving the
 * production DSN/release/privacy wiring end to end. Temporary: remove this
 * route once the event is confirmed in the Sentry Issues UI.
 *
 * Auth: CRON_SECRET Bearer (same as other internal endpoints).
 */
async function handleGET(request: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = request.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  throw new Error('Fitsy Sentry verification');
}

export const GET = withApiTelemetry('GET', '/api/internal/sentry-test', handleGET);
