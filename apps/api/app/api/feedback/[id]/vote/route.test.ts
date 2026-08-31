jest.mock("@/lib/auth", () => ({
  requireAuth: jest.fn(),
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    feedback: { findUnique: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
    feedbackVote: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";

const AUTH_OK = { sub: "user-1", email: "alice@example.com" };
const PUBLISHED_POST = { id: "fb-1", status: "published" };

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/feedback/fb-1/vote", { method: "POST" });
}

function makeParams(id = "fb-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue(AUTH_OK);
  (prisma.feedback.findUnique as jest.Mock).mockResolvedValue(PUBLISHED_POST);
});

describe("POST /api/feedback/[id]/vote", () => {
  it("returns the 401 from requireAuth and touches nothing else", async () => {
    (requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    expect(prisma.feedback.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 for a post that doesn't exist", async () => {
    (prisma.feedback.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 404 for a hidden post", async () => {
    (prisma.feedback.findUnique as jest.Mock).mockResolvedValue({ id: "fb-1", status: "hidden" });

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("creates a vote and increments voteCount when the user hasn't voted", async () => {
    (prisma.feedbackVote.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockResolvedValue([{}, { voteCount: 4 }]);

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ voteCount: 4, hasVoted: true });
    expect(prisma.feedbackVote.create).toHaveBeenCalledWith({
      data: { feedbackId: "fb-1", userId: "user-1" },
    });
  });

  it("removes the vote and decrements voteCount when the user already voted", async () => {
    (prisma.feedbackVote.findUnique as jest.Mock).mockResolvedValue({ id: "vote-1" });
    (prisma.$transaction as jest.Mock).mockResolvedValue([{}, { voteCount: 2 }]);

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ voteCount: 2, hasVoted: false });
    expect(prisma.feedbackVote.delete).toHaveBeenCalledWith({ where: { id: "vote-1" } });
  });

  it("treats a concurrent duplicate-vote race as already-voted instead of erroring", async () => {
    (prisma.feedbackVote.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error("unique constraint"));
    (prisma.feedback.findUniqueOrThrow as jest.Mock).mockResolvedValue({ voteCount: 5 });

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ voteCount: 5, hasVoted: true });
  });
});
