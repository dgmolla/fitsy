// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockRequireAuth = jest.fn();
const mockSync = jest.fn();
const mockIsEntitled = jest.fn();
const mockBypass = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));
jest.mock("@/lib/subscription", () => ({
  syncSubscriptionFromRevenueCat: (...args: unknown[]) => mockSync(...args),
  isEntitled: (...args: unknown[]) => mockIsEntitled(...args),
  subscriptionBypass: (...args: unknown[]) => mockBypass(...args),
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";

const req = new NextRequest("http://localhost/api/subscriptions/sync", { method: "POST" });

beforeEach(() => {
  jest.resetAllMocks();
  mockRequireAuth.mockResolvedValue({ sub: "user-1", email: "a@b.c" });
  mockBypass.mockReturnValue(false);
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
    expect(mockSync).toHaveBeenCalledWith("user-1");
    expect(await res.json()).toEqual({ active: true, synced: true });
  });

  it("reports inactive when RevenueCat says the user is not entitled", async () => {
    mockSync.mockResolvedValue(false);
    expect(await (await POST(req)).json()).toEqual({ active: false, synced: true });
  });

  it("falls back to the DB state when RevenueCat can't be consulted", async () => {
    mockSync.mockResolvedValue(null);
    mockIsEntitled.mockResolvedValue(true);
    expect(await (await POST(req)).json()).toEqual({ active: true, synced: false });
    expect(mockIsEntitled).toHaveBeenCalledWith("user-1", "a@b.c");
  });

  it("short-circuits for bypassed (demo/stub) accounts", async () => {
    mockBypass.mockReturnValue(true);
    expect(await (await POST(req)).json()).toEqual({ active: true, synced: false });
    expect(mockSync).not.toHaveBeenCalled();
  });
});
