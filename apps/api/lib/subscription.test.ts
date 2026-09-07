// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockUserFindUnique = jest.fn();
const mockRequireAuth = jest.fn();
const mockFetchProEntitlement = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    subscription: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
  },
}));
jest.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));
jest.mock("@/services/revenuecatService", () => ({
  fetchProEntitlement: (...args: unknown[]) => mockFetchProEntitlement(...args),
}));

import { NextRequest, NextResponse } from "next/server";
import {
  isEntitled,
  getEntitlementStatus,
  subscriptionBypass,
  optionalSubscription,
  syncSubscriptionFromRevenueCat,
  logStatusChange,
} from "./subscription";

const ENV = process.env;
beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...ENV };
  delete process.env["ALLOW_STUB_SUBSCRIPTIONS"];
  delete process.env["DEMO_REVIEW_EMAILS"];
});
afterAll(() => {
  process.env = ENV;
});

const req = {} as unknown as NextRequest;

describe("subscriptionBypass", () => {
  it("bypasses when ALLOW_STUB_SUBSCRIPTIONS=true (dev/staging)", () => {
    process.env["ALLOW_STUB_SUBSCRIPTIONS"] = "true";
    expect(subscriptionBypass("anyone@example.com")).toBe(true);
  });

  it("bypasses demo/reviewer emails, case-insensitively", () => {
    process.env["DEMO_REVIEW_EMAILS"] = "review@fitsy.app, demo@fitsy.app";
    expect(subscriptionBypass("REVIEW@fitsy.app")).toBe(true);
    expect(subscriptionBypass("demo@fitsy.app")).toBe(true);
  });

  it("does not bypass a normal user", () => {
    process.env["DEMO_REVIEW_EMAILS"] = "review@fitsy.app";
    expect(subscriptionBypass("alice@example.com")).toBe(false);
  });
});

describe("isEntitled", () => {
  it("true for an active subscription with no expiry", async () => {
    mockFindUnique.mockResolvedValue({ status: "active", expiresAt: null });
    expect(await isEntitled("u1", "a@b.com")).toBe(true);
  });

  it("true for an active subscription expiring in the future", async () => {
    mockFindUnique.mockResolvedValue({ status: "active", expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await isEntitled("u1", "a@b.com")).toBe(true);
  });

  it("false for an active subscription that has already lapsed", async () => {
    mockFindUnique.mockResolvedValue({ status: "active", expiresAt: new Date(Date.now() - 1_000) });
    expect(await isEntitled("u1", "a@b.com")).toBe(false);
  });

  it("false for an expired status", async () => {
    mockFindUnique.mockResolvedValue({ status: "expired", expiresAt: null });
    expect(await isEntitled("u1", "a@b.com")).toBe(false);
  });

  it("true for billing_issue while the grace period hasn't lapsed (store keeps the user subscribed)", async () => {
    mockFindUnique.mockResolvedValue({ status: "billing_issue", expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await isEntitled("u1", "a@b.com")).toBe(true);
  });

  it("false for billing_issue once the period has lapsed", async () => {
    mockFindUnique.mockResolvedValue({ status: "billing_issue", expiresAt: new Date(Date.now() - 1_000) });
    expect(await isEntitled("u1", "a@b.com")).toBe(false);
  });

  it("false when there is no subscription row", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await isEntitled("u1", "a@b.com")).toBe(false);
  });

  it("bypass short-circuits before touching the DB", async () => {
    process.env["ALLOW_STUB_SUBSCRIPTIONS"] = "true";
    expect(await isEntitled("u1", "a@b.com")).toBe(true);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe("getEntitlementStatus", () => {
  const expiresAt = new Date(Date.now() + 86_400_000);

  it("reports the row alongside the same verdict as isEntitled", async () => {
    mockFindUnique.mockResolvedValue({ status: "active", expiresAt });
    expect(await getEntitlementStatus("u1", "a@b.com")).toEqual({
      active: true,
      status: "active",
      expiresAt,
    });
  });

  it("keeps the lapsed row visible while reporting inactive", async () => {
    const past = new Date(Date.now() - 1_000);
    mockFindUnique.mockResolvedValue({ status: "active", expiresAt: past });
    expect(await getEntitlementStatus("u1", "a@b.com")).toEqual({
      active: false,
      status: "active",
      expiresAt: past,
    });
  });

  it("returns nulls for a user who never subscribed", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getEntitlementStatus("u1", "a@b.com")).toEqual({
      active: false,
      status: null,
      expiresAt: null,
    });
  });

  it("is active for a bypassed account even without a row", async () => {
    process.env["DEMO_REVIEW_EMAILS"] = "review@fitsy.app";
    mockFindUnique.mockResolvedValue(null);
    expect(await getEntitlementStatus("u1", "review@fitsy.app")).toEqual({
      active: true,
      status: null,
      expiresAt: null,
    });
  });
});

describe("logStatusChange", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("logs a tagged from -> to line when the status changes", () => {
    logStatusChange("u1", "active", "expired", "sync");
    expect(warn).toHaveBeenCalledWith("[subscription] u1 status active -> expired (sync)");
  });

  it("reports a first row as coming from none", () => {
    logStatusChange("u1", null, "active", "webhook");
    expect(warn).toHaveBeenCalledWith("[subscription] u1 status none -> active (webhook)");
  });

  it("stays silent when the status is unchanged (renewals, repeated syncs)", () => {
    logStatusChange("u1", "active", "active", "sync");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("optionalSubscription", () => {
  it("never rejects — reports entitled: false when requireAuth fails (no/bad token)", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const result = await optionalSubscription(req);
    expect(result).toEqual({ payload: null, entitled: false });
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("reports entitled: true with the payload when authenticated AND entitled", async () => {
    mockRequireAuth.mockResolvedValue({ sub: "u1", email: "a@b.com" });
    mockFindUnique.mockResolvedValue({ status: "active", expiresAt: null });
    expect(await optionalSubscription(req)).toEqual({
      payload: { sub: "u1", email: "a@b.com" },
      entitled: true,
    });
  });

  it("reports entitled: false with the payload when authenticated but not subscribed", async () => {
    mockRequireAuth.mockResolvedValue({ sub: "u1", email: "a@b.com" });
    mockFindUnique.mockResolvedValue(null);
    expect(await optionalSubscription(req)).toEqual({
      payload: { sub: "u1", email: "a@b.com" },
      entitled: false,
    });
  });
});

describe("syncSubscriptionFromRevenueCat", () => {
  const expiresAt = new Date(Date.now() + 86_400_000);
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue({ id: "u1" });
    mockUpsert.mockResolvedValue({});
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.useFakeTimers({ now: new Date("2026-09-06T12:00:00Z") });
  });
  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
  });
  const NOW = new Date("2026-09-06T12:00:00Z");

  it("returns null and writes nothing when RevenueCat can't be consulted", async () => {
    mockFetchProEntitlement.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBeNull();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("writes an active row for an entitled user (transfer / webhook race / missed delivery)", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: true,
      plan: "com.fitsy.mobile.yearly",
      expiresAt,
      transactionId: "txn",
      billingIssue: false,
    });
    mockFindUnique.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: {
        userId: "u1",
        plan: "com.fitsy.mobile.yearly",
        status: "active",
        expiresAt,
        appleTransactionId: "txn",
        lastEventAt: NOW,
      },
      update: {
        plan: "com.fitsy.mobile.yearly",
        status: "active",
        expiresAt,
        appleTransactionId: "txn",
        lastEventAt: NOW,
      },
    });
  });

  it("stamps lastEventAt = now so an older webhook arriving later cannot overwrite the REST read", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: true,
      plan: "p",
      expiresAt,
      transactionId: null,
      billingIssue: false,
    });
    mockFindUnique.mockResolvedValue({ status: "active" });
    await syncSubscriptionFromRevenueCat("u1");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ lastEventAt: NOW }) }),
    );
  });

  it("logs a [subscription] line when the sync flips the stored status", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: false,
      plan: null,
      expiresAt: null,
      transactionId: null,
      billingIssue: false,
    });
    mockFindUnique.mockResolvedValue({ status: "active" });
    await syncSubscriptionFromRevenueCat("u1");
    expect(warn).toHaveBeenCalledWith("[subscription] u1 status active -> expired (sync)");
  });

  it("does not log when the sync confirms the stored status", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: true,
      plan: "p",
      expiresAt,
      transactionId: null,
      billingIssue: false,
    });
    mockFindUnique.mockResolvedValue({ status: "active" });
    await syncSubscriptionFromRevenueCat("u1");
    expect(warn).not.toHaveBeenCalled();
  });

  it("writes billing_issue (still entitled) during a grace period, matching the webhook", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: true,
      plan: "p",
      expiresAt,
      transactionId: null,
      billingIssue: true,
    });
    mockFindUnique.mockResolvedValue({ status: "active" });
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: "billing_issue" }) }),
    );
  });

  it("expires an existing row without wiping plan/expiry/transaction when the entitlement is gone", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: false,
      plan: null,
      expiresAt: null,
      transactionId: null,
      billingIssue: false,
    });
    mockFindUnique.mockResolvedValue({ status: "active" });
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(false);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { status: "expired", lastEventAt: NOW } }),
    );
  });

  it("writes nothing for a user who never subscribed", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: false,
      plan: null,
      expiresAt: null,
      transactionId: null,
      billingIssue: false,
    });
    mockFindUnique.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("reports RevenueCat's answer but persists nothing when the User row is gone", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: true,
      plan: "p",
      expiresAt,
      transactionId: null,
      billingIssue: false,
    });
    mockUserFindUnique.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(true);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
