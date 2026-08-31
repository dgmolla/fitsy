import { NextRequest, NextResponse, after } from "next/server";
import { requireAuth } from "@/lib/auth";
import { feedbackLimiter } from "@/lib/rateLimit";
import { containsProfanity } from "@/lib/moderation";
import { prisma } from "@/lib/restaurantService";
import {
  FEEDBACK_MAX_LENGTH,
  postSlackMessage,
  type FeedbackApiResponse,
  type FeedbackBoardApiResponse,
  type FeedbackBoardPost,
} from "@fitsy/shared";
import { buildFeedbackAlert } from "@/lib/feedbackDigest";

// ─── POST /api/feedback ───────────────────────────────────────────────────────
//
// Persists a user's free-text feedback to the Feedback table, then posts it to
// Slack (deferred via after(), after the response is sent) with a one-click
// reply link (the daily digest cron is the safety net). The Slack post is
// best-effort: it never fails the request. Requires a valid Bearer JWT.
//
// Every submission is also a public board post (status defaults to
// "published"), so it's moderated up front with a basic profanity gate
// instead of after the fact.
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

  if (containsProfanity(trimmed)) {
    return NextResponse.json(
      { error: "Please remove inappropriate language and try again" },
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

    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: { name: true },
    });
    const displayName = user?.name?.trim() || auth.email.split("@")[0]!;

    const feedback = await prisma.feedback.create({
      data: {
        userId: auth.sub,
        userEmail: auth.email,
        displayName,
        message: trimmed,
      },
      select: { id: true, createdAt: true },
    });

    // Real-time nudge so the 24h personal-reply rule is actually met.
    // postSlackMessage never throws and no-ops without SLACK_BOT_TOKEN.
    // Deferred via after() so the 201 returns right after the insert instead
    // of waiting on the Slack round-trip.
    const alertText = buildFeedbackAlert({
      userEmail: auth.email,
      message: trimmed,
      createdAt: feedback.createdAt,
    });
    try {
      after(() => postSlackMessage(alertText));
    } catch {
      /* test env or non-runtime */
    }

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

// ─── GET /api/feedback ────────────────────────────────────────────────────────
//
// Public feedback board: published posts, most-upvoted first (ties broken by
// newest). Requires auth only so `hasVoted` can be computed per requester —
// every signed-in user sees every published post.

export async function GET(
  request: NextRequest,
): Promise<NextResponse<FeedbackBoardApiResponse>> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  const { searchParams } = request.nextUrl;
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw !== null ? Math.min(Number(limitRaw), 50) : 20;

  try {
    const posts = await prisma.feedback.findMany({
      where: { status: "published" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ voteCount: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        displayName: true,
        message: true,
        voteCount: true,
        createdAt: true,
        votes: { where: { userId: auth.sub }, select: { id: true } },
      },
    });

    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;

    const data: FeedbackBoardPost[] = page.map((post) => ({
      id: post.id,
      displayName: post.displayName,
      message: post.message,
      voteCount: post.voteCount,
      createdAt: post.createdAt.toISOString(),
      hasVoted: post.votes.length > 0,
    }));

    return NextResponse.json(
      { data, meta: { hasMore, ...(nextCursor ? { cursor: nextCursor } : {}) } },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
