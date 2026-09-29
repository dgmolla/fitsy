// Write-path tests for lib/subscription: syncSubscriptionFromRevenueCat.
// Read helpers and logging live in subscription.test.ts.
// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockUpdateMany = jest.fn();
const mockCreate = jest.fn();
const mockUserFindUnique = jest.fn();
const mockRequireAuth = jest.fn();
const mockFetchProEntitlement = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    subscription: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      create: (...args: unknown[]) => mockCreate(...args),
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

import { syncSubscriptionFromRevenueCat } from "./subscription";

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


describe("syncSubscriptionFromRevenueCat", () => {
  const expiresAt = new Date(Date.now() + 86_400_000);
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue({ id: "u1" });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockCreate.mockResolvedValue({});
    log = jest.spyOn(console, "info").mockImplementation(() => {});
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.useFakeTimers({ now: new Date("2026-09-06T12:00:00Z") });
  });
  afterEach(() => {
    log.mockRestore();
    warn.mockRestore();
    jest.useRealTimers();
  });
  const NOW = new Date("2026-09-06T12:00:00Z");

  it("returns null and writes nothing when RevenueCat can't be consulted", async () => {
    mockFetchProEntitlement.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
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
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        plan: "com.fitsy.mobile.yearly",
        status: "active",
        expiresAt,
        appleTransactionId: "txn",
        lastEventAt: NOW,
      },
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("stamps lastEventAt with the READ START, not the return time, so a renewal during the read is not dropped", async () => {
    mockFetchProEntitlement.mockImplementation(async () => {
      // RevenueCat takes 5 s to answer; a RENEWAL fires meanwhile.
      jest.setSystemTime(NOW.getTime() + 5_000);
      return { active: true, plan: "p", expiresAt, transactionId: null, billingIssue: false };
    });
    mockFindUnique.mockResolvedValue({ status: "active" });
    await syncSubscriptionFromRevenueCat("u1");
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastEventAt: NOW }) }),
    );
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
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastEventAt: NOW }) }),
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
    expect(log).toHaveBeenCalledWith("[subscription] u1 status active -> expired (sync)");
    expect(warn).not.toHaveBeenCalled();
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
    expect(log).not.toHaveBeenCalled();
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
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "billing_issue" }) }),
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
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "expired", lastEventAt: NOW } }),
    );
  });

  it("persists RevenueCat's confirmed lack of subscription history", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: false,
      plan: null,
      expiresAt: null,
      transactionId: null,
      billingIssue: false,
    });
    mockFindUnique.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(false);
    expect(mockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "never_subscribed", lastEventAt: NOW }) });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("preserves expired history when the webhook never created a row", async () => {
    mockFetchProEntitlement.mockResolvedValue({
      active: false, hadProEntitlement: true, plan: "p", expiresAt: new Date(NOW.getTime() - 1_000),
      transactionId: null, billingIssue: false,
    });
    mockFindUnique.mockResolvedValue(null);
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(false);
    expect(mockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "expired" }) });
  });

  it("does not replace an active purchase row that races an empty-account read", async () => {
    mockFetchProEntitlement.mockResolvedValue({ active: false, hadProEntitlement: false, plan: null, expiresAt: null, transactionId: null, billingIssue: false });
    mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      status: "active", expiresAt: new Date(NOW.getTime() + 60_000), lastEventAt: NOW,
    });
    mockCreate.mockRejectedValueOnce(new Error("unique userId"));
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(true);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer purchase webhook on an existing never row", async () => {
    mockFetchProEntitlement.mockResolvedValue({ active: false, hadProEntitlement: false, plan: null, expiresAt: null, transactionId: null, billingIssue: false });
    mockFindUnique.mockResolvedValueOnce({ status: "never_subscribed", lastEventAt: new Date(NOW.getTime() - 1_000) })
      .mockResolvedValueOnce({ status: "active", expiresAt: new Date(NOW.getTime() + 60_000), lastEventAt: new Date(NOW.getTime() + 1_000) });
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await syncSubscriptionFromRevenueCat("u1")).toBe(true);
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      userId: "u1", OR: [{ lastEventAt: null }, { lastEventAt: { lte: NOW } }],
    }) }));
    expect(mockCreate).not.toHaveBeenCalled();
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
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("stamps lastEventAt from RevenueCat's request_date_ms (its clock orders webhook events)", async () => {
    const requestDate = new Date(NOW.getTime() - 2_500);
    mockFetchProEntitlement.mockResolvedValue({
      active: true,
      plan: "p",
      expiresAt,
      transactionId: null,
      billingIssue: false,
      requestDate,
    });
    mockFindUnique.mockResolvedValue({ status: "active" });
    await syncSubscriptionFromRevenueCat("u1");
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastEventAt: requestDate }) }),
    );
  });

});
