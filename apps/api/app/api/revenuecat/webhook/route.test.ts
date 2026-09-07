// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockReadUserAndRow = jest.fn();
const mockSubscriptionUpsert = jest.fn();
const mockSubscriptionUpdateMany = jest.fn();
const mockSync = jest.fn();
const mockLogStatusChange = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    subscription: {
      upsert: mockSubscriptionUpsert,
      updateMany: mockSubscriptionUpdateMany,
    },
  },
}));
jest.mock("@/lib/subscription", () => ({
  readUserAndRow: (...args: unknown[]) => mockReadUserAndRow(...args),
  syncSubscriptionFromRevenueCat: (...args: unknown[]) => mockSync(...args),
  logStatusChange: (...args: unknown[]) => mockLogStatusChange(...args),
}));

import { POST } from "./route";
import { AUTH, event, makeRequest } from "./fixtures";

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  process.env["REVENUECAT_WEBHOOK_AUTH"] = AUTH;
  mockReadUserAndRow.mockResolvedValue({ userExists: true, row: null });
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
    mockReadUserAndRow.mockResolvedValue({ userExists: false, row: null });
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
    mockReadUserAndRow.mockResolvedValue({ userExists: true, row: { status: "expired", lastEventAt: null } });
    await POST(makeRequest(event(), AUTH));
    expect(mockLogStatusChange).toHaveBeenCalledWith("user-1", "expired", "active", "webhook");
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
      data: { status: "expired", lastEventAt: expect.any(Date) },
    });
  });

  it("stamps the fallback expiry as now so a delayed pre-transfer RENEWAL can't revive the old owner", async () => {
    mockSync.mockResolvedValue(null);
    const before = Date.now();
    await POST(makeRequest(transfer, AUTH));
    const stamped = mockSubscriptionUpdateMany.mock.calls[0][0].data.lastEventAt as Date;
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
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
