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
  subscriptionBypass,
  requireSubscription,
  optionalSubscription,
  syncSubscriptionFromRevenueCat,
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

  it("false for a non-active status (expired / billing_issue)", async () => {
    mockFindUnique.mockResolvedValue({ status: "expired", expiresAt: null });
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

describe("requireSubscription", () => {
  it("propagates the 401 from requireAuth when unauthenticated", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireAuth.mockResolvedValue(unauth);
    const res = await requireSubscription(req);
    expect(res).toBe(unauth);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns the payload when authenticated AND entitled", async () => {
    mockRequireAuth.mockResolvedValue({ sub: "u1", email: "a@b.com" });
    mockFindUnique.mockResolvedValue({ status: "active", expiresAt: null });
    expect(await requireSubscription(req)).toEqual({ sub: "u1", email: "a@b.com" });
  });

  it("returns 402 subscription_required when authenticated but not entitled", async () => {
    mockRequireAuth.mockResolvedValue({ sub: "u1", email: "a@b.com" });
    mockFindUnique.mockResolvedValue(null);
    const res = await requireSubscription(req);
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(402);
    expect(await (res as NextResponse).json()).toEqual({ error: "subscription_required" });
  });

  it("lets the demo reviewer account through without a subscription row", async () => {
    process.env["DEMO_REVIEW_EMAILS"] = "review@fitsy.app";
    mockRequireAuth.mockResolvedValue({ sub: "u1", email: "review@fitsy.app" });
    expect(await requireSubscription(req)).toEqual({ sub: "u1", email: "review@fitsy.app" });
    expect(mockFindUnique).not.toHaveBeenCalled();
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

  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue({ id: "u1" });
    mockUpsert.mockResolvedValue({});
  });

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
      },
      update: {
        plan: "com.fitsy.mobile.yearly",
        status: "active",
        expiresAt,
        appleTransactionId: "txn",
      },
    });
  });

  it("expires an existing row when the entitlement moved away or lapsed", async () => {
    mockFetchProEntitlement.mockResolvedValue({ active: false, plan: "p", expiresAt: null, transactionId: null });
    mockFindUnique.mockResolvedValue({ id: "sub-1" });
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(false);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: "expired" }) }),
    );
  });

  it("writes nothing for a user who never subscribed", async () => {
    mockFetchProEntitlement.mockResolvedValue({ active: false, plan: null, expiresAt: null, transactionId: null });
    mockFindUnique.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("reports RevenueCat's answer but persists nothing when the User row is gone", async () => {
    mockFetchProEntitlement.mockResolvedValue({ active: true, plan: "p", expiresAt, transactionId: null });
    mockUserFindUnique.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(true);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
