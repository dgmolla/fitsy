import { useRateLimitTransport } from "@/tests/fixtures/rateLimitTransport";
useRateLimitTransport();

jest.mock("@/lib/auth", () => ({ requireAuth: jest.fn() }));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    feedback: { findUnique: jest.fn() },
    feedbackReport: { create: jest.fn() },
  },
}));

const mockPostSlackMessage = jest.fn();
jest.mock("@fitsy/shared", () => {
  const actual = jest.requireActual("@fitsy/shared");
  return { __esModule: true, ...actual, postSlackMessage: (...args: unknown[]) => mockPostSlackMessage(...args) };
});
jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return { ...actual, after: (cb: () => unknown) => { void cb(); } };
});

import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";

const AUTH_OK = { sub: "user-1", email: "alice@example.com" };
const POST_ROW = { id: "fb-1", status: "published", userId: "author-1", message: "add dark mode" };
const makeRequest = () => new NextRequest("http://localhost/api/feedback/fb-1/report", { method: "POST" });
const makeParams = (id = "fb-1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue(AUTH_OK);
  (prisma.feedback.findUnique as jest.Mock).mockResolvedValue(POST_ROW);
  (prisma.feedbackReport.create as jest.Mock).mockResolvedValue({});
});

describe("POST /api/feedback/[id]/report", () => {
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
    expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
  });

  it("rejects reporting your own post", async () => {
    (prisma.feedback.findUnique as jest.Mock).mockResolvedValue({ ...POST_ROW, userId: "user-1" });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(400);
    expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
  });

  it("stores the report and nudges moderation without the reporter's identity", async () => {
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { reported: true } });
    expect(prisma.feedbackReport.create).toHaveBeenCalledWith({ data: { feedbackId: "fb-1", reporterId: "user-1" } });
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1);
    expect(String(mockPostSlackMessage.mock.calls[0][0])).toContain("fb-1");
    expect(String(mockPostSlackMessage.mock.calls[0][0])).not.toContain("alice@example.com");
  });

  it("treats a repeat report as a success without a second nudge", async () => {
    (prisma.feedbackReport.create as jest.Mock).mockRejectedValue(new Error("P2002"));
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { reported: true } });
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });

  it("returns 500 when the lookup throws", async () => {
    (prisma.feedback.findUnique as jest.Mock).mockRejectedValue(new Error("db down"));
    expect((await POST(makeRequest(), makeParams())).status).toBe(500);
  });
});
