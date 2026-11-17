import { useRateLimitTransport } from "@/tests/fixtures/rateLimitTransport";
useRateLimitTransport();

jest.mock("@/lib/auth", () => ({ requireAuth: jest.fn() }));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    feedback: { findUnique: jest.fn() },
    userBlock: { create: jest.fn() },
  },
}));

import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";

const AUTH_OK = { sub: "user-1", email: "alice@example.com" };
const POST_ROW = { id: "fb-1", status: "published", userId: "author-1" };
const makeRequest = () => new NextRequest("http://localhost/api/feedback/fb-1/block", { method: "POST" });
const makeParams = (id = "fb-1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue(AUTH_OK);
  (prisma.feedback.findUnique as jest.Mock).mockResolvedValue(POST_ROW);
  (prisma.userBlock.create as jest.Mock).mockResolvedValue({});
});

describe("POST /api/feedback/[id]/block", () => {
  it("returns the 401 from requireAuth and touches nothing else", async () => {
    (requireAuth as jest.Mock).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    expect(prisma.feedback.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or hidden post", async () => {
    (prisma.feedback.findUnique as jest.Mock).mockResolvedValueOnce(null);
    expect((await POST(makeRequest(), makeParams())).status).toBe(404);
    (prisma.feedback.findUnique as jest.Mock).mockResolvedValueOnce({ ...POST_ROW, status: "hidden" });
    expect((await POST(makeRequest(), makeParams())).status).toBe(404);
    expect(prisma.userBlock.create).not.toHaveBeenCalled();
  });

  it("rejects blocking yourself", async () => {
    (prisma.feedback.findUnique as jest.Mock).mockResolvedValue({ ...POST_ROW, userId: "user-1" });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(400);
    expect(prisma.userBlock.create).not.toHaveBeenCalled();
  });

  it("blocks the post's author for the requester", async () => {
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { blocked: true } });
    expect(prisma.userBlock.create).toHaveBeenCalledWith({ data: { blockerId: "user-1", blockedId: "author-1" } });
  });

  it("treats a repeat block as a success", async () => {
    (prisma.userBlock.create as jest.Mock).mockRejectedValue(new Error("P2002"));
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { blocked: true } });
  });

  it("returns 500 when the lookup throws", async () => {
    (prisma.feedback.findUnique as jest.Mock).mockRejectedValue(new Error("db down"));
    expect((await POST(makeRequest(), makeParams())).status).toBe(500);
  });
});
