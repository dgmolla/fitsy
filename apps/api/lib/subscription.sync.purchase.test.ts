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


const expiresAt = new Date(Date.now() + 86_400_000);
let warn: jest.SpyInstance;
beforeEach(() => {
  mockUserFindUnique.mockResolvedValue({ id: "u1" });
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockCreate.mockResolvedValue({});
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.useFakeTimers({ now: new Date("2026-09-06T12:00:00Z") });
});
afterEach(() => {
  warn.mockRestore();
  jest.useRealTimers();
});

describe("neverDowngrade (purchase / restore)", () => {
    const inactive = { active: false, plan: null, expiresAt: null, transactionId: null, billingIssue: false };
    const active = { active: true, plan: "p", expiresAt, transactionId: null, billingIssue: false };

    /** Drive the 1 s retry sleeps under fake timers past the 6 s budget. */
    async function syncWithRetries(): Promise<boolean | null> {
      const pending = syncSubscriptionFromRevenueCat("u1", { neverDowngrade: true });
      await jest.advanceTimersByTimeAsync(10_000);
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
      expect(mockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "active" }) });
    });

    it("writes nothing and returns null when still inactive once the 6 s budget is spent", async () => {
      mockFetchProEntitlement.mockResolvedValue(inactive);
      mockFindUnique.mockResolvedValue({ status: "active" });
      expect(await syncWithRetries()).toBeNull();
      // First read at t=0, then one re-read per second while elapsed < 6 s.
      expect(mockFetchProEntitlement).toHaveBeenCalledTimes(7);
      expect(mockUpdateMany).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[subscription] u1 RevenueCat still inactive after 7 reads over 6000 ms"),
      );
    });

    it("stops retrying early when a re-read fails outright, without writing", async () => {
      mockFetchProEntitlement.mockResolvedValueOnce(inactive).mockResolvedValueOnce(null);
      mockFindUnique.mockResolvedValue({ status: "active" });
      expect(await syncWithRetries()).toBeNull();
      expect(mockFetchProEntitlement).toHaveBeenCalledTimes(2);
      expect(mockUpdateMany).not.toHaveBeenCalled();
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
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "expired" }) }),
      );
    });
  });
