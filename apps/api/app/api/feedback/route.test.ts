// ─── Mock modules ─────────────────────────────────────────────────────────────

jest.mock("@/lib/auth", () => ({
  requireAuth: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  feedbackLimiter: { check: jest.fn(() => ({ ok: true, remaining: 4, retryAfterMs: 0 })) },
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: { feedback: { count: jest.fn(), create: jest.fn() } },
}));

import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { feedbackLimiter } from "@/lib/rateLimit";
import { prisma } from "@/lib/restaurantService";

const AUTH_OK = { sub: "user-1", email: "alice@example.com" };
const CREATED = { id: "fb-1", createdAt: new Date("2026-06-06T00:00:00.000Z") };

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue(AUTH_OK);
  (feedbackLimiter.check as jest.Mock).mockReturnValue({
    ok: true,
    remaining: 4,
    retryAfterMs: 0,
  });
  (prisma.feedback.count as jest.Mock).mockResolvedValue(0);
  (prisma.feedback.create as jest.Mock).mockResolvedValue(CREATED);
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ─── Success ──────────────────────────────────────────────────────────────────

describe("POST /api/feedback — success", () => {
  it("returns 201 and persists the trimmed message with userId + email", async () => {
    const res = await POST(makeRequest({ message: "  love the app  " }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe("fb-1");
    expect(prisma.feedback.create).toHaveBeenCalledWith({
      data: { userId: "user-1", userEmail: "alice@example.com", message: "love the app" },
      select: { id: true, createdAt: true },
    });
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe("POST /api/feedback — auth", () => {
  it("returns the 401 from requireAuth and does not write", async () => {
    (requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makeRequest({ message: "hi" }));
    expect(res.status).toBe(401);
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });
});

// ─── Throttling ─────────────────────────────────────────────────────────────────

describe("POST /api/feedback — throttling", () => {
  it("returns 429 when the in-process limiter rejects", async () => {
    (feedbackLimiter.check as jest.Mock).mockReturnValue({
      ok: false,
      remaining: 0,
      retryAfterMs: 30_000,
    });

    const res = await POST(makeRequest({ message: "spam" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });

  it("returns 429 when the daily DB cap is reached", async () => {
    (prisma.feedback.count as jest.Mock).mockResolvedValue(20);

    const res = await POST(makeRequest({ message: "one more" }));
    expect(res.status).toBe(429);
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/feedback — validation", () => {
  it("returns 400 for invalid JSON", async () => {
    const res = await POST(makeRequest("not-json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when message is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when message is blank", async () => {
    const res = await POST(makeRequest({ message: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when message exceeds the max length", async () => {
    const res = await POST(makeRequest({ message: "x".repeat(5001) }));
    expect(res.status).toBe(400);
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });
});

// ─── DB failure ─────────────────────────────────────────────────────────────────

describe("POST /api/feedback — db failure", () => {
  it("returns 500 when the write throws", async () => {
    (prisma.feedback.create as jest.Mock).mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest({ message: "hello" }));
    expect(res.status).toBe(500);
  });
});
