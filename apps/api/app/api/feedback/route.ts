import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { feedbackLimiter } from "@/lib/rateLimit";
import { prisma } from "@/lib/restaurantService";
import { FEEDBACK_MAX_LENGTH, type FeedbackApiResponse } from "@fitsy/shared";

// ─── POST /api/feedback ───────────────────────────────────────────────────────
//
// Persists a user's free-text feedback to the Feedback table so it can be read
// and triaged directly from the DB (e.g. via the Supabase CLI). Requires a
// valid Bearer JWT.
//
// Throttling is two-layered and conservative:
//   1. In-process limiter — cheap per-instance burst guard.
//   2. DB count over the last 24h — survives serverless cold starts (which
//      reset the in-process limiter) and caps sustained spam.

/** Max feedback rows a single user may create in a rolling 24h window. */
const DAILY_CAP = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(
  request: NextRequest,
): Promise<NextResponse<FeedbackApiResponse>> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  // Layer 1: in-process burst limiter.
  const rateResult = feedbackLimiter.check(auth.sub);
  if (!rateResult.ok) {
    return NextResponse.json(
      { error: "Too many requests — please try again later" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateResult.retryAfterMs / 1000)),
        },
      },
    );
  }

  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message } = body;
  if (typeof message !== "string" || message.trim() === "") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const trimmed = message.trim();
  if (trimmed.length > FEEDBACK_MAX_LENGTH) {
    return NextResponse.json(
      { error: `message must be ${FEEDBACK_MAX_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  try {
    // Layer 2: cold-start-proof daily cap.
    const recentCount = await prisma.feedback.count({
      where: { userId: auth.sub, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
    });
    if (recentCount >= DAILY_CAP) {
      return NextResponse.json(
        { error: "Daily feedback limit reached — please try again tomorrow" },
        { status: 429 },
      );
    }

    const feedback = await prisma.feedback.create({
      data: { userId: auth.sub, userEmail: auth.email, message: trimmed },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json(
      { data: { id: feedback.id, createdAt: feedback.createdAt.toISOString() } },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
