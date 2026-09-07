// Idempotency tests for the webhook: lastEventAt stamping, stale/duplicate
// deliveries and the RevenueCat re-read tiebreaker. Auth, parsing,
// persistence and TRANSFER are covered in route.test.ts.
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
import { AUTH, EVENT_MS, event, makeRequest } from "./fixtures";

/** A fixed period end so row and event expiries can be compared exactly. */
const EXP_MS = EVENT_MS + 365 * 24 * 3600 * 1000;

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
    mockReadUserAndRow.mockResolvedValue({ userExists: true, row: { status: "active", lastEventAt: new Date(EVENT_MS) } });
    const res = await POST(makeRequest(event(), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).toHaveBeenCalledTimes(1);
    expect(mockLogStatusChange).toHaveBeenCalledWith("user-1", "active", "active", "webhook");
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("acks an out-of-order older event that agrees with the row without writing or syncing", async () => {
    mockReadUserAndRow.mockResolvedValue({
      userExists: true,
      row: { status: "active", expiresAt: new Date(EXP_MS), lastEventAt: new Date(EVENT_MS + 60_000) },
    });
    const res = await POST(makeRequest(event({ type: "RENEWAL", expiration_at_ms: EXP_MS }), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("re-reads RevenueCat when a stale RENEWAL keeps the status but moves expiresAt", async () => {
    // The sync-vs-renewal race: same "active" status, later period end. Without
    // the expiry comparison the row would keep the old expiresAt and lock the
    // user out when it passes.
    mockReadUserAndRow.mockResolvedValue({
      userExists: true,
      row: { status: "active", expiresAt: new Date(EXP_MS), lastEventAt: new Date(EVENT_MS + 60_000) },
    });
    mockSync.mockResolvedValue(true);
    const res = await POST(
      makeRequest(event({ type: "RENEWAL", expiration_at_ms: EXP_MS + 30 * 24 * 3600 * 1000 }), AUTH),
    );
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
    expect(mockSync).toHaveBeenCalledWith("user-1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("expiresAt"));
  });

  it("re-reads RevenueCat as the tiebreaker when a stale event disagrees with the row", async () => {
    mockReadUserAndRow.mockResolvedValue({ userExists: true, row: { status: "active", lastEventAt: new Date(EVENT_MS + 60_000) } });
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
    mockReadUserAndRow.mockResolvedValue({ userExists: true, row: { status: "active", lastEventAt: new Date(EVENT_MS + 60_000) } });
    mockSync.mockResolvedValue(null);
    const res = await POST(
      makeRequest(event({ type: "EXPIRATION", expiration_at_ms: Date.now() - 1000 }), AUTH),
    );
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("tiebreak sync failed"));
  });

  it("applies a newer event over an older stored one", async () => {
    mockReadUserAndRow.mockResolvedValue({ userExists: true, row: { status: "active", lastEventAt: new Date(EVENT_MS - 60_000) } });
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
    mockReadUserAndRow.mockResolvedValue({ userExists: true, row: { status: "expired", lastEventAt: new Date(EVENT_MS) } });
    await POST(makeRequest(event({ event_timestamp_ms: undefined }), AUTH));
    expect(mockSubscriptionUpsert).toHaveBeenCalledTimes(1);
    const stamped = mockSubscriptionUpsert.mock.calls[0][0].update.lastEventAt as Date;
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("ignores a webhook older than a REST sync that already stamped the row", async () => {
    // syncSubscriptionFromRevenueCat writes lastEventAt = now(); a delivery
    // generated before that read is stale even though it just arrived.
    mockReadUserAndRow.mockResolvedValue({
      userExists: true,
      row: { status: "active", expiresAt: new Date(EXP_MS), lastEventAt: new Date() },
    });
    const res = await POST(makeRequest(event({ event_timestamp_ms: EVENT_MS, expiration_at_ms: EXP_MS }), AUTH));
    expect(res.status).toBe(200);
    expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("still applies an event when the row has no lastEventAt yet (pre-migration rows)", async () => {
    mockReadUserAndRow.mockResolvedValue({ userExists: true, row: { status: "active", lastEventAt: null } });
    await POST(makeRequest(event({ event_timestamp_ms: EVENT_MS - 10 * 365 * 24 * 3600 * 1000 }), AUTH));
    expect(mockSubscriptionUpsert).toHaveBeenCalledTimes(1);
  });
});
