// Write-path tests for lib/subscription: syncSubscriptionFromRevenueCat.
// Read helpers and logging live in subscription.test.ts.
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

  it("stamps lastEventAt with the READ START, not the return time, so a renewal during the read is not dropped", async () => {
    mockFetchProEntitlement.mockImplementation(async () => {
      // RevenueCat takes 5 s to answer; a RENEWAL fires meanwhile.
      jest.setSystemTime(NOW.getTime() + 5_000);
      return { active: true, plan: "p", expiresAt, transactionId: null, billingIssue: false };
    });
    mockFindUnique.mockResolvedValue({ status: "active" });
    await syncSubscriptionFromRevenueCat("u1");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ lastEventAt: NOW }) }),
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
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ lastEventAt: requestDate }) }),
    );
  });

  describe("neverDowngrade (purchase / restore)", () => {
    const inactive = { active: false, plan: null, expiresAt: null, transactionId: null, billingIssue: false };
    const active = { active: true, plan: "p", expiresAt, transactionId: null, billingIssue: false };

    /** Drive the 1 s retry sleeps under fake timers. */
    async function syncWithRetries(): Promise<boolean | null> {
      const pending = syncSubscriptionFromRevenueCat("u1", { neverDowngrade: true });
      await jest.advanceTimersByTimeAsync(3_000);
      return pending;
    }

    it("retries an inactive read and writes the row once RevenueCat catches up", async () => {
      mockFetchProEntitlement
        .mockResolvedValueOnce(inactive)
        .mockResolvedValueOnce(inactive)
        .mockResolvedValueOnce(active);
      mockFindUnique.mockResolvedValue(null);
      expect(await syncWithRetries()).toBe(true);
      expect(mockFetchProEntitlement).toHaveBeenCalledTimes(3);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ status: "active" }) }),
      );
    });

    it("writes nothing and returns null when still inactive after three reads", async () => {
      mockFetchProEntitlement.mockResolvedValue(inactive);
      mockFindUnique.mockResolvedValue({ status: "active" });
      expect(await syncWithRetries()).toBeNull();
      expect(mockFetchProEntitlement).toHaveBeenCalledTimes(3);
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[subscription] u1 RevenueCat still inactive"));
    });

    it("does not retry an active first read", async () => {
      mockFetchProEntitlement.mockResolvedValue(active);
      mockFindUnique.mockResolvedValue({ status: "active" });
      expect(await syncWithRetries()).toBe(true);
      expect(mockFetchProEntitlement).toHaveBeenCalledTimes(1);
    });

    it("still downgrades on an ordinary (mismatch) sync", async () => {
      mockFetchProEntitlement.mockResolvedValue(inactive);
      mockFindUnique.mockResolvedValue({ status: "active" });
      expect(await syncSubscriptionFromRevenueCat("u1")).toBe(false);
      expect(mockFetchProEntitlement).toHaveBeenCalledTimes(1);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: "expired" }) }),
      );
    });
  });
});
