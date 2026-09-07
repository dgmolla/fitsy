// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUserFindUnique = jest.fn();
const mockSubscriptionFindUnique = jest.fn();
const mockSubscriptionUpsert = jest.fn();
const mockSubscriptionUpdateMany = jest.fn();
const mockSync = jest.fn();
const mockLogStatusChange = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    subscription: {
      findUnique: mockSubscriptionFindUnique,
      upsert: mockSubscriptionUpsert,
      updateMany: mockSubscriptionUpdateMany,
    },
  },
}));
jest.mock("@/lib/subscription", () => ({
  syncSubscriptionFromRevenueCat: (...args: unknown[]) => mockSync(...args),
  logStatusChange: (...args: unknown[]) => mockLogStatusChange(...args),
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

/** Fixed event time so ordering assertions don't depend on the wall clock. */
const EVENT_MS = Date.UTC(2026, 8, 6, 12, 0, 0);

function event(overrides: Record<string, unknown> = {}) {
  return {
    event: {
      type: "INITIAL_PURCHASE",
      app_user_id: "user-1",
      product_id: "fitsy.annual",
      expiration_at_ms: Date.now() + 365 * 24 * 60 * 60 * 1000,
      transaction_id: "txn-1",
      event_timestamp_ms: EVENT_MS,
      ...overrides,
    },
  };
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  process.env["REVENUECAT_WEBHOOK_AUTH"] = AUTH;
  mockUserFindUnique.mockResolvedValue({ id: "user-1" });
  mockSubscriptionFindUnique.mockResolvedValue(null);
  mockSubscriptionUpsert.mockResolvedValue({});
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env["REVENUECAT_WEBHOOK_AUTH"];
  warn.mockRestore();
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

  it("logs the status transition against the previously stored row", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({ status: "expired", lastEventAt: null });
    await POST(makeRequest(event(), AUTH));
    expect(mockLogStatusChange).toHaveBeenCalledWith("user-1", "expired", "active", "webhook");
  });
});

describe("POST /api/revenuecat/webhook - idempotency", () => {
  it("stamps lastEventAt with the event time on a fresh write", async () => {
    await POST(makeRequest(event(), AUTH));
    expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ lastEventAt: new Date(EVENT_MS) }),
        update: expect.objectContaining({ lastEventAt: new Date(EVENT_MS) }),
      }),
    );
  });

  it("re-applies a duplicate delivery (equal timestamp) harmlessly: last write wins", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({
      status: "active",
      lastEventAt: new Date(EVENT_MS),
    });
    const res = await POST(makeRequest(event(), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).toHaveBeenCalledTimes(1);
    expect(mockLogStatusChange).toHaveBeenCalledWith("user-1", "active", "active", "webhook");
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("acks an out-of-order older event that agrees with the row without writing or syncing", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({
      status: "active",
      lastEventAt: new Date(EVENT_MS + 60_000),
    });
    const res = await POST(makeRequest(event({ type: "RENEWAL" }), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("re-reads RevenueCat as the tiebreaker when a stale event disagrees with the row", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({
      status: "active",
      lastEventAt: new Date(EVENT_MS + 60_000),
    });
    mockSync.mockResolvedValue(false);
    const res = await POST(
      makeRequest(event({ type: "EXPIRATION", expiration_at_ms: Date.now() - 1000 }), AUTH),
    );
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
    expect(mockSync).toHaveBeenCalledWith("user-1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[subscription] user-1 stale EXPIRATION"));
  });

  it("still acks a conflicting stale event when the tiebreaker sync can't reach RevenueCat", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({
      status: "active",
      lastEventAt: new Date(EVENT_MS + 60_000),
    });
    mockSync.mockResolvedValue(null);
    const res = await POST(
      makeRequest(event({ type: "EXPIRATION", expiration_at_ms: Date.now() - 1000 }), AUTH),
    );
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("tiebreak sync failed"));
  });

  it("applies a newer event over an older stored one", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({
      status: "active",
      lastEventAt: new Date(EVENT_MS - 60_000),
    });
    await POST(
      makeRequest(event({ type: "EXPIRATION", expiration_at_ms: Date.now() - 1000 }), AUTH),
    );
    expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "expired", lastEventAt: new Date(EVENT_MS) }),
      }),
    );
  });

  it("applies an event with no timestamp as 'now' rather than dropping it", async () => {
    const before = Date.now();
    mockSubscriptionFindUnique.mockResolvedValue({
      status: "expired",
      lastEventAt: new Date(EVENT_MS),
    });
    await POST(makeRequest(event({ event_timestamp_ms: undefined }), AUTH));
    expect(mockSubscriptionUpsert).toHaveBeenCalledTimes(1);
    const stamped = mockSubscriptionUpsert.mock.calls[0][0].update.lastEventAt as Date;
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("ignores a webhook older than a REST sync that already stamped the row", async () => {
    // syncSubscriptionFromRevenueCat writes lastEventAt = now(); a delivery
    // generated before that read is stale even though it just arrived.
    mockSubscriptionFindUnique.mockResolvedValue({
      status: "active",
      lastEventAt: new Date(),
    });
    const res = await POST(makeRequest(event({ event_timestamp_ms: EVENT_MS }), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("still applies an event when the row has no lastEventAt yet (pre-migration rows)", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({ status: "active", lastEventAt: null });
    await POST(makeRequest(event({ event_timestamp_ms: EVENT_MS - 10 * 365 * 24 * 3600 * 1000 }), AUTH));
    expect(mockSubscriptionUpsert).toHaveBeenCalledTimes(1);
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

  it("returns 500 (RevenueCat retries) when the NEW owner can't be synced, still expiring the old one", async () => {
    mockSync.mockResolvedValue(null);
    const res = await POST(makeRequest(transfer, AUTH));
    expect(res.status).toBe(500);
    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-old" },
      data: { status: "expired" },
    });
  });

  it("acks when only the OLD owner's lookup failed (already expired directly)", async () => {
    mockSync.mockImplementation(async (id: string) => (id === "user-old" ? null : true));
    const res = await POST(makeRequest(transfer, AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("returns 500 so RevenueCat retries when the sync throws", async () => {
    mockSync.mockRejectedValue(new Error("db down"));
    const res = await POST(makeRequest(transfer, AUTH));
    expect(res.status).toBe(500);
  });
});
