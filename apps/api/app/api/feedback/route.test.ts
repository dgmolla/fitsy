// ─── Mock modules ─────────────────────────────────────────────────────────────

jest.mock("@/lib/auth", () => ({
  requireAuth: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  feedbackLimiter: { check: jest.fn(() => ({ ok: true, remaining: 4, retryAfterMs: 0 })) },
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    feedback: { count: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/moderation", () => ({
  containsProfanity: jest.fn(() => false),
}));

const mockPostSlackMessage = jest.fn();

jest.mock("@fitsy/shared", () => {
  const actual = jest.requireActual("@fitsy/shared");
  return {
    __esModule: true,
    ...actual,
    postSlackMessage: (...args: unknown[]) => mockPostSlackMessage(...args),
  };
});

// after() requires the Next.js request-context runtime, which jest doesn't
// provide. Mock it to invoke the callback immediately so the deferred Slack
// post is observable in tests.
jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    after: (cb: () => unknown) => {
      void cb();
    },
  };
});

import { GET, POST } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { feedbackLimiter } from "@/lib/rateLimit";
import { containsProfanity } from "@/lib/moderation";
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
  (containsProfanity as jest.Mock).mockReturnValue(false);
  (prisma.feedback.count as jest.Mock).mockResolvedValue(0);
  (prisma.feedback.create as jest.Mock).mockResolvedValue(CREATED);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: "Alice" });
  (prisma.feedback.findMany as jest.Mock).mockResolvedValue([]);
  mockPostSlackMessage.mockResolvedValue(true);
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeGetRequest(qs = ""): NextRequest {
  return new NextRequest(`http://localhost/api/feedback${qs}`);
}

// ─── Success ──────────────────────────────────────────────────────────────────

describe("POST /api/feedback — success", () => {
  it("returns 201 and persists the trimmed message with userId + email", async () => {
    const res = await POST(makeRequest({ message: "  love the app  " }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe("fb-1");
    expect(prisma.feedback.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        userEmail: "alice@example.com",
        displayName: "Alice",
        message: "love the app",
      },
      select: { id: true, createdAt: true },
    });
  });

  it("falls back to the email local-part when the user has no name set", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: null });

    const res = await POST(makeRequest({ message: "hi" }));

    expect(res.status).toBe(201);
    expect(prisma.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: "alice" }) }),
    );
  });

  it("posts the feedback alert to Slack with the user's email and message", async () => {
    const res = await POST(makeRequest({ message: "love the app" }));

    expect(res.status).toBe(201);
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1);
    const text = mockPostSlackMessage.mock.calls[0]![0] as string;
    expect(text).toContain("alice@example.com");
    expect(text).toContain("love the app");
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

  it("does not post to Slack on validation failure", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });
});

// ─── Moderation ───────────────────────────────────────────────────────────────

describe("POST /api/feedback — moderation", () => {
  it("returns 400 and does not write when the profanity filter flags the message", async () => {
    (containsProfanity as jest.Mock).mockReturnValue(true);

    const res = await POST(makeRequest({ message: "this is a bad message" }));

    expect(res.status).toBe(400);
    expect(prisma.feedback.create).not.toHaveBeenCalled();
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });
});

// ─── GET /api/feedback (board) ──────────────────────────────────────────────────

describe("GET /api/feedback — board", () => {
  const ROW = {
    id: "fb-1",
    displayName: "Alice",
    message: "add dark mode",
    voteCount: 3,
    createdAt: new Date("2026-06-06T00:00:00.000Z"),
    votes: [],
  };

  it("returns the 401 from requireAuth", async () => {
    (requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns published posts sorted by vote count, with hasVoted computed per user", async () => {
    (prisma.feedback.findMany as jest.Mock).mockResolvedValue([
      { ...ROW, votes: [{ id: "vote-1" }] },
    ]);

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "published" } }),
    );
    expect(body.data).toEqual([
      {
        id: "fb-1",
        displayName: "Alice",
        message: "add dark mode",
        voteCount: 3,
        createdAt: "2026-06-06T00:00:00.000Z",
        hasVoted: true,
      },
    ]);
    expect(body.meta.hasMore).toBe(false);
  });

  it("sets hasVoted false when the requester has no vote row", async () => {
    (prisma.feedback.findMany as jest.Mock).mockResolvedValue([ROW]);

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(body.data[0].hasVoted).toBe(false);
  });

  it("paginates via cursor and reports hasMore", async () => {
    const extra = { ...ROW, id: "fb-2" };
    (prisma.feedback.findMany as jest.Mock).mockResolvedValue([ROW, extra]);

    const res = await GET(makeGetRequest("?limit=1"));
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.meta).toEqual({ hasMore: true, cursor: "fb-1" });
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
