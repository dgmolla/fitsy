import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";
import type { FeedbackVoteApiResponse } from "@fitsy/shared";

// ─── POST /api/feedback/[id]/vote ─────────────────────────────────────────────
//
// Toggles the requesting user's upvote on a board post: no existing vote ->
// create one and increment voteCount; existing vote -> remove it and
// decrement. One button on the client, no separate unvote endpoint.
//
// The `@@unique([feedbackId, userId])` constraint (not this check-then-act
// logic) is what actually guarantees one vote per person — a concurrent
// double-tap that races past the findUnique below will still fail on create
// with P2002, handled as a no-op below.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<FeedbackVoteApiResponse>> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  const { id: feedbackId } = await params;
  const userId = auth.sub;

  try {
    const post = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      select: { id: true, status: true },
    });
    if (!post || post.status !== "published") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const existing = await prisma.feedbackVote.findUnique({
      where: { feedbackId_userId: { feedbackId, userId } },
    });

    if (existing) {
      const [, updated] = await prisma.$transaction([
        prisma.feedbackVote.delete({ where: { id: existing.id } }),
        prisma.feedback.update({
          where: { id: feedbackId },
          data: { voteCount: { decrement: 1 } },
          select: { voteCount: true },
        }),
      ]);
      return NextResponse.json(
        { data: { voteCount: updated.voteCount, hasVoted: false } },
        { status: 200 },
      );
    }

    try {
      const [, updated] = await prisma.$transaction([
        prisma.feedbackVote.create({ data: { feedbackId, userId } }),
        prisma.feedback.update({
          where: { id: feedbackId },
          data: { voteCount: { increment: 1 } },
          select: { voteCount: true },
        }),
      ]);
      return NextResponse.json(
        { data: { voteCount: updated.voteCount, hasVoted: true } },
        { status: 200 },
      );
    } catch {
      // Lost the race to another concurrent vote from the same user — read
      // back the current state rather than double-incrementing.
      const current = await prisma.feedback.findUniqueOrThrow({
        where: { id: feedbackId },
        select: { voteCount: true },
      });
      return NextResponse.json(
        { data: { voteCount: current.voteCount, hasVoted: true } },
        { status: 200 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
