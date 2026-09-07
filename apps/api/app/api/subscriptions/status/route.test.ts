// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockRequireAuth = jest.fn();
const mockGetEntitlementStatus = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));
jest.mock("@/lib/subscription", () => ({
  getEntitlementStatus: (...args: unknown[]) => mockGetEntitlementStatus(...args),
}));

import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

const req = new NextRequest("http://localhost/api/subscriptions/status");

beforeEach(() => {
  jest.resetAllMocks();
  mockRequireAuth.mockResolvedValue({ sub: "user-1", email: "a@b.c" });
});

describe("GET /api/subscriptions/status", () => {
  it("returns the auth failure when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(mockGetEntitlementStatus).not.toHaveBeenCalled();
  });

  it("returns the verdict with the row status and an ISO expiry", async () => {
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    mockGetEntitlementStatus.mockResolvedValue({ active: true, status: "active", expiresAt });
    const res = await GET(req);
    expect(mockGetEntitlementStatus).toHaveBeenCalledWith("user-1", "a@b.c");
    expect(await res.json()).toEqual({
      active: true,
      status: "active",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
  });

  it("returns nulls for a user with no subscription row", async () => {
    mockGetEntitlementStatus.mockResolvedValue({ active: false, status: null, expiresAt: null });
    expect(await (await GET(req)).json()).toEqual({ active: false, status: null, expiresAt: null });
  });
});
