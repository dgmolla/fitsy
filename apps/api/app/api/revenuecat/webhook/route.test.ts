// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUserFindUnique = jest.fn();
const mockSubscriptionUpsert = jest.fn();
const mockSubscriptionUpdateMany = jest.fn();
const mockSync = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    subscription: { upsert: mockSubscriptionUpsert, updateMany: mockSubscriptionUpdateMany },
  },
}));
jest.mock("@/lib/subscription", () => ({
  syncSubscriptionFromRevenueCat: (...args: unknown[]) => mockSync(...args),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

const AUTH = "Bearer rc-secret";

function makeRequest(body: unknown, authHeader?: string | null): NextRequest {
  return new NextRequest("http://localhost/api/revenuecat/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    event: {
      type: "INITIAL_PURCHASE",
      app_user_id: "user-1",
      product_id: "fitsy.annual",
      expiration_at_ms: Date.now() + 365 * 24 * 60 * 60 * 1000,
      transaction_id: "txn-1",
      ...overrides,
    },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env["REVENUECAT_WEBHOOK_AUTH"] = AUTH;
  mockUserFindUnique.mockResolvedValue({ id: "user-1" });
  mockSubscriptionUpsert.mockResolvedValue({});
});

afterEach(() => {
  delete process.env["REVENUECAT_WEBHOOK_AUTH"];
});

describe("POST /api/revenuecat/webhook — auth", () => {
  it("returns 503 when REVENUECAT_WEBHOOK_AUTH is unset", async () => {
    delete process.env["REVENUECAT_WEBHOOK_AUTH"];
    const res = await POST(makeRequest(event(), AUTH));
    expect(res.status).toBe(503);
  });

  it("returns 401 when the Authorization header does not match", async () => {
    const res = await POST(makeRequest(event(), "Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/revenuecat/webhook — parsing", () => {
  it("returns 400 on invalid JSON", async () => {
    const res = await POST(makeRequest("not-json", AUTH));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the event is missing", async () => {
    const res = await POST(makeRequest({}, AUTH));
    expect(res.status).toBe(400);
  });

  it("acknowledges TEST events without writing", async () => {
    const res = await POST(makeRequest(event({ type: "TEST" }), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
  });

  it("acknowledges UNKNOWN event types without writing (no accidental grant)", async () => {
    const res = await POST(
      makeRequest(event({ type: "SOME_FUTURE_PAUSE_EVENT" }), AUTH),
    );
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
  });

  it("falls back to the merged (non-anonymous) alias when the purchase was made pre-login", async () => {
    const res = await POST(
      makeRequest(
        event({
          app_user_id: "$RCAnonymousID:abc",
          aliases: ["$RCAnonymousID:abc", "user-1"],
        }),
        AUTH,
      ),
    );
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
  });

  it("acknowledges anonymous app_user_id without writing", async () => {
    const res = await POST(
      makeRequest(event({ app_user_id: "$RCAnonymousID:abc" }), AUTH),
    );
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/revenuecat/webhook — persistence", () => {
  it("acknowledges (200) when the user does not exist, without upserting", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(makeRequest(event(), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
  });

  it("upserts an active subscription on INITIAL_PURCHASE", async () => {
    const res = await POST(makeRequest(event(), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        create: expect.objectContaining({
          userId: "user-1",
          plan: "fitsy.annual",
          status: "active",
        }),
        update: expect.objectContaining({ status: "active" }),
      }),
    );
  });

  it("marks the subscription expired on EXPIRATION", async () => {
    await POST(
      makeRequest(
        event({ type: "EXPIRATION", expiration_at_ms: Date.now() - 1000 }),
        AUTH,
      ),
    );
    expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "expired" }),
      }),
    );
  });

  it("keeps access active on CANCELLATION until the period ends", async () => {
    await POST(makeRequest(event({ type: "CANCELLATION" }), AUTH));
    expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "active" }),
      }),
    );
  });

  it("returns 500 on a transient DB error so RevenueCat retries", async () => {
    mockSubscriptionUpsert.mockRejectedValue(new Error("db down"));
    const res = await POST(makeRequest(event(), AUTH));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/revenuecat/webhook — TRANSFER", () => {
  const transfer = {
    event: {
      type: "TRANSFER",
      app_user_id: "user-new",
      transferred_from: ["user-old", "$RCAnonymousID:x"],
      transferred_to: ["user-new"],
    },
  };

  it("re-reads both sides from RevenueCat instead of trusting the event", async () => {
    mockSync.mockResolvedValue(true);
    const res = await POST(makeRequest(transfer, AUTH));
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith("user-new");
    expect(mockSync).toHaveBeenCalledWith("user-old");
    expect(mockSync).not.toHaveBeenCalledWith("$RCAnonymousID:x");
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdateMany).not.toHaveBeenCalled();
  });

  it("expires the old owner directly when RevenueCat can't be consulted", async () => {
    mockSync.mockResolvedValue(null);
    const res = await POST(makeRequest(transfer, AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-old" },
      data: { status: "expired" },
    });
  });

  it("returns 500 so RevenueCat retries when the sync throws", async () => {
    mockSync.mockRejectedValue(new Error("db down"));
    const res = await POST(makeRequest(transfer, AUTH));
    expect(res.status).toBe(500);
  });
});
