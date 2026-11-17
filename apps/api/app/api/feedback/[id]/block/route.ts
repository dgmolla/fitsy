import { withApiTelemetry } from '@/lib/apiTelemetry';
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { feedbackLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/restaurantService";
import type { FeedbackBlockApiResponse } from "@fitsy/shared";

// ─── POST /api/feedback/[id]/block ────────────────────────────────────────────
//
// Blocks the author of a board post: the blocker no longer sees that user's
// posts (GET /api/feedback filters them). The board only exposes display names,
// so the block is addressed through a post id. One block per (blocker, author)
// via `@@unique([blockerId, blockedId])`; a repeat is a no-op success. A user
// cannot block themselves.

async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<FeedbackBlockApiResponse>> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  const rateResult = await feedbackLimiter.check(auth.sub);
  if (!rateResult.ok) return rateLimitResponse(rateResult, 'Too many requests - please try again later');

  const { id: feedbackId } = await params;

  try {
    const post = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      select: { id: true, status: true, userId: true },
    });
    if (!post || post.status !== "published") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (post.userId === auth.sub) {
      return NextResponse.json({ error: "You cannot block yourself" }, { status: 400 });
    }

    try {
      await prisma.userBlock.create({ data: { blockerId: auth.sub, blockedId: post.userId } });
    } catch {
      // Already blocked (unique constraint): treat as success.
    }

    return NextResponse.json({ data: { blocked: true } }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiTelemetry('POST', '/api/feedback/[id]/block', handlePOST);
