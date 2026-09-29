// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockRequireAuth = jest.fn();
const mockSync = jest.fn();
const mockGetEntitlementStatus = jest.fn();
const mockBypass = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));
jest.mock("@/lib/subscription", () => ({
  syncSubscriptionFromRevenueCat: (...args: unknown[]) => mockSync(...args),
  getEntitlementStatus: (...args: unknown[]) => mockGetEntitlementStatus(...args),
  subscriptionBypass: (...args: unknown[]) => mockBypass(...args),
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";

const req = new NextRequest("http://localhost/api/subscriptions/sync", { method: "POST" });
const withReason = (reason: unknown) =>
  new NextRequest("http://localhost/api/subscriptions/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });

beforeEach(() => {
  jest.resetAllMocks();
  mockRequireAuth.mockResolvedValue({ sub: "user-1", email: "a@b.c" });
  mockBypass.mockReturnValue(false);
  mockGetEntitlementStatus.mockResolvedValue({
    active: true, status: "active", expiresAt: null,
    verdict: "active", lastRcVerifiedAt: null, stale: false,
  });
});

describe("POST /api/subscriptions/sync", () => {
  it("returns the auth failure when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("syncs from RevenueCat and reports the fresh state", async () => {
    mockSync.mockResolvedValue(true);
    const res = await POST(req);
    expect(mockSync).toHaveBeenCalledWith("user-1", { neverDowngrade: false });
    expect(await res.json()).toEqual(expect.objectContaining({ active: true, verdict: "active", synced: true }));
  });

  it.each(["purchase", "restore"])("never downgrades on a %s sync", async (reason) => {
    mockSync.mockResolvedValue(true);
    await POST(withReason(reason));
    expect(mockSync).toHaveBeenCalledWith("user-1", { neverDowngrade: true });
  });

  it.each(["boot", "sign_in", "mismatch", "bogus", 42])("allows a downgrade for reason %p", async (reason) => {
    mockSync.mockResolvedValue(false);
    await POST(withReason(reason));
    expect(mockSync).toHaveBeenCalledWith("user-1", { neverDowngrade: false });
  });

  it("reports inactive when RevenueCat says the user is not entitled", async () => {
    mockSync.mockResolvedValue(false);
    mockGetEntitlementStatus.mockResolvedValue({ active: false, status: "expired", expiresAt: null, verdict: "expired", lastRcVerifiedAt: null, stale: false });
    expect(await (await POST(req)).json()).toEqual(expect.objectContaining({ active: false, verdict: "expired", synced: true }));
  });

  it("falls back to the DB state when RevenueCat can't be consulted", async () => {
    mockSync.mockResolvedValue(null);
    mockGetEntitlementStatus.mockResolvedValue({ active: false, status: "expired", expiresAt: null, verdict: "expired", lastRcVerifiedAt: null, stale: false });
    expect(await (await POST(req)).json()).toEqual(expect.objectContaining({ active: false, verdict: "expired", synced: false }));
    expect(mockGetEntitlementStatus).toHaveBeenCalledWith("user-1", "a@b.c");
  });

  it("short-circuits for bypassed (demo/stub) accounts", async () => {
    mockBypass.mockReturnValue(true);
    expect(await (await POST(req)).json()).toEqual(expect.objectContaining({ active: true, verdict: "active", synced: false }));
    expect(mockSync).not.toHaveBeenCalled();
  });
});
