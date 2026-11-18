import { withApiTelemetry } from '@/lib/apiTelemetry';
import { NextRequest, NextResponse, after } from "next/server";
import { requireAuth } from "@/lib/auth";
import { feedbackLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/restaurantService";
import { postSlackMessage, type FeedbackReportApiResponse } from "@fitsy/shared";

// ─── POST /api/feedback/[id]/report ───────────────────────────────────────────
//
// Reports a board post for moderation. One report per (post, reporter): the
// `@@unique([feedbackId, reporterId])` constraint enforces it, and a repeat is
// a no-op success. A user cannot report their own post. The reporter stops
// seeing the post (GET /api/feedback filters it); everyone else still sees it
// until a moderator hides it (status -> hidden). A moderation nudge goes to
// Slack, best-effort, without the reporter's identity.

async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<FeedbackReportApiResponse>> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  const rateResult = await feedbackLimiter.check(auth.sub);
  if (!rateResult.ok) return rateLimitResponse(rateResult, 'Too many requests - please try again later');

  const { id: feedbackId } = await params;

  try {
    const post = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      select: { id: true, status: true, userId: true, message: true },
    });
    if (!post || post.status !== "published") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (post.userId === auth.sub) {
      return NextResponse.json({ error: "You cannot report your own post" }, { status: 400 });
    }

    try {
      await prisma.feedbackReport.create({ data: { feedbackId, reporterId: auth.sub } });
    } catch {
      // Already reported by this user (unique constraint): treat as success.
      return NextResponse.json({ data: { reported: true } }, { status: 200 });
    }

    const excerpt = post.message.length > 140 ? `${post.message.slice(0, 140)}...` : post.message;
    try {
      after(() => postSlackMessage(`:triangular_flag_on_post: Feedback post reported (id ${feedbackId}): "${excerpt}"`));
    } catch {
      /* test env or non-runtime */
    }

    return NextResponse.json({ data: { reported: true } }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiTelemetry('POST', '/api/feedback/[id]/report', handlePOST);
