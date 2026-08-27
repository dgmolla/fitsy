import { NextRequest, NextResponse } from "next/server";
import { reportServerError } from "@/lib/errorAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/alert-test — verify the error-alerting pipeline end to end.
 *
 * Auth: CRON_SECRET Bearer (same as the other internal endpoints).
 *   ?mode=report (default) — calls reportServerError directly; proves the
 *     Slack path works.
 *   ?mode=throw — throws, so the alert must arrive via the instrumentation
 *     onRequestError hook; proves uncaught route errors reach Slack.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mode = req.nextUrl.searchParams.get("mode") ?? "report";
  if (mode === "throw") {
    throw new Error(`alert-test: deliberate uncaught error (${Date.now()})`);
  }

  reportServerError(
    `alert-test ${Date.now()}`,
    new Error("alert-test: deliberate reported error"),
  );
  return NextResponse.json({ ok: true, mode: "report" });
}
