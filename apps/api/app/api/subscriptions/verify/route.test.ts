// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAuth = jest.fn();
const mockPrismaSubscriptionUpsert = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    subscription: {
      upsert: mockPrismaSubscriptionUpsert,
    },
  },
}));

import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };

function makeRequest(body: unknown, authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/subscriptions/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("POST /api/subscriptions/verify — auth guard", () => {
  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(
      makeRequest({ receiptData: "abc", productId: "fitsy.annual" }),
    );
    expect(res.status).toBe(401);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/subscriptions/verify — validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
  });

  it("returns 400 when receiptData is missing", async () => {
    const res = await POST(
      makeRequest({ productId: "fitsy.annual" }, "Bearer valid"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/receiptData/i);
  });

  it("returns 400 when productId is missing", async () => {
    const res = await POST(
      makeRequest({ receiptData: "abc" }, "Bearer valid"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/productId/i);
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/subscriptions/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── Success ──────────────────────────────────────────────────────────────────

describe("POST /api/subscriptions/verify — success", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockPrismaSubscriptionUpsert.mockResolvedValue({});
  });

  it("creates/upserts subscription and returns success response", async () => {
    const res = await POST(
      makeRequest(
        { receiptData: "base64receipt==", productId: "fitsy.annual" },
        "Bearer valid",
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.plan).toBe("fitsy.annual");
    expect(body.status).toBe("active");
    expect(body.expiresAt).toBeDefined();
  });

  it("sets expiresAt approximately 1 year from now", async () => {
    const before = Date.now();
    const res = await POST(
      makeRequest(
        { receiptData: "base64receipt==", productId: "fitsy.annual" },
        "Bearer valid",
      ),
    );
    const after = Date.now();

    const body = await res.json();
    const expiresAt = new Date(body.expiresAt).getTime();
    const oneYear = 365 * 24 * 60 * 60 * 1000;

    expect(expiresAt).toBeGreaterThanOrEqual(before + oneYear - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + oneYear + 1000);
  });

  it("calls prisma upsert with correct data", async () => {
    await POST(
      makeRequest(
        { receiptData: "receipt-data", productId: "fitsy.monthly" },
        "Bearer valid",
      ),
    );

    expect(mockPrismaSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        create: expect.objectContaining({
          userId: "user-1",
          plan: "fitsy.monthly",
          status: "active",
        }),
        update: expect.objectContaining({
          plan: "fitsy.monthly",
          status: "active",
        }),
      }),
    );
  });
});
