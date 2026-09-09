// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAuth = jest.fn();
const mockSavedItemDeleteMany = jest.fn();
const mockMacroTargetDeleteMany = jest.fn();
const mockSubscriptionDeleteMany = jest.fn();
const mockWaitlistDeleteMany = jest.fn();
const mockWaitlistUpdateMany = jest.fn();
const mockWaitlistCount = jest.fn();
const mockUserFindUnique = jest.fn();
const mockMarketingSendDeleteMany = jest.fn();
const mockUserDelete = jest.fn();
const mockTransaction = jest.fn();
const mockSupabaseDeleteUser = jest.fn();
const mockGetSupabaseAdmin = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    savedItem: { deleteMany: mockSavedItemDeleteMany },
    macroTarget: { deleteMany: mockMacroTargetDeleteMany },
    subscription: { deleteMany: mockSubscriptionDeleteMany },
    launchWaitlist: { deleteMany: mockWaitlistDeleteMany, updateMany: mockWaitlistUpdateMany, count: mockWaitlistCount },
    marketingSend: { deleteMany: mockMarketingSendDeleteMany },
    user: { delete: mockUserDelete, findUnique: mockUserFindUnique },
    $transaction: mockTransaction,
  },
}));

jest.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: mockGetSupabaseAdmin,
}));

import { DELETE } from "./route";
import { NextRequest, NextResponse } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockSavedItemDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockMacroTargetDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockSubscriptionDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockWaitlistDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockWaitlistUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  mockWaitlistCount.mockReset().mockResolvedValue(0);
  mockUserFindUnique.mockReset().mockResolvedValue({ email: "Alice@Example.com" });
  mockMarketingSendDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockUserDelete.mockReset().mockResolvedValue({ id: "user-1" });
  mockTransaction.mockReset();
  mockSupabaseDeleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  mockGetSupabaseAdmin.mockReset().mockReturnValue({
    auth: { admin: { deleteUser: mockSupabaseDeleteUser } },
  });

  // Default: $transaction invokes the callback with the prisma-like tx,
  // so the route's `tx.savedItem.deleteMany` etc. flows to the mocks above.
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      savedItem: { deleteMany: mockSavedItemDeleteMany },
      macroTarget: { deleteMany: mockMacroTargetDeleteMany },
      subscription: { deleteMany: mockSubscriptionDeleteMany },
      launchWaitlist: { deleteMany: mockWaitlistDeleteMany, updateMany: mockWaitlistUpdateMany, count: mockWaitlistCount },
      marketingSend: { deleteMany: mockMarketingSendDeleteMany },
      user: { delete: mockUserDelete, findUnique: mockUserFindUnique },
    };
    return fn(tx);
  });
});

function makeDeleteRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers["Authorization"] = authHeader;
  return new NextRequest("http://localhost/api/user", {
    method: "DELETE",
    headers,
  });
}

// ─── DELETE — auth guard ──────────────────────────────────────────────────────

describe("DELETE /api/user — auth guard", () => {
  it("returns 401 when Authorization header is missing", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await DELETE(makeDeleteRequest());

    expect(res.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSupabaseDeleteUser).not.toHaveBeenCalled();
  });
});

// ─── DELETE — success ─────────────────────────────────────────────────────────

describe("DELETE /api/user — success", () => {
  it("returns 204 and deletes from all 4 tables + Supabase auth", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);

    const res = await DELETE(makeDeleteRequest("Bearer valid.token"));

    expect(res.status).toBe(204);

    expect(mockSavedItemDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mockMacroTargetDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mockSubscriptionDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    // Only the onboarding-only, never-opted-out waitlist row goes with the
    // account; website rows and opt-out records survive, unlinked.
    expect(mockWaitlistDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", source: "onboarding", emailOptOutAt: null },
    });
    // Whatever survives keeps only the email + opt-out: the location the
    // account supplied goes with the account.
    expect(mockWaitlistUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { lat: null, lng: null, city: null },
    });
    // No waitlist row survives for the address, so its send history goes too.
    expect(mockWaitlistCount).toHaveBeenCalledWith({ where: { email: "alice@example.com" } });
    expect(mockMarketingSendDeleteMany).toHaveBeenCalledWith({ where: { email: "alice@example.com" } });
    const deleteOrder = mockWaitlistDeleteMany.mock.invocationCallOrder[0]!;
    const stripOrder = mockWaitlistUpdateMany.mock.invocationCallOrder[0]!;
    const countOrder = mockWaitlistCount.mock.invocationCallOrder[0]!;
    const purgeOrder = mockMarketingSendDeleteMany.mock.invocationCallOrder[0]!;
    const userOrder = mockUserDelete.mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeLessThan(userOrder);
    expect(stripOrder).toBeLessThan(userOrder);
    // The survivor count must run AFTER the onboarding row is deleted, or a
    // row about to be removed would keep the ledger history alive.
    expect(countOrder).toBeGreaterThan(deleteOrder);
    expect(purgeOrder).toBeGreaterThan(countOrder);
    expect(purgeOrder).toBeLessThan(userOrder);
    expect(mockUserDelete).toHaveBeenCalledWith({
      where: { id: "user-1" },
    });

    expect(mockSupabaseDeleteUser).toHaveBeenCalledWith("user-1");
  });

  it("skips the ledger purge when the user row is already gone", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockUserFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest("Bearer good"));
    expect(res.status).toBe(204);
    expect(mockMarketingSendDeleteMany).not.toHaveBeenCalled();
  });

  it("keeps the send ledger when a waitlist row for the address survives", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockWaitlistCount.mockResolvedValue(1); // website-sourced row remains, still a recipient
    const res = await DELETE(makeDeleteRequest("Bearer good"));
    expect(res.status).toBe(204);
    expect(mockWaitlistCount).toHaveBeenCalledWith({ where: { email: "alice@example.com" } });
    expect(mockMarketingSendDeleteMany).not.toHaveBeenCalled();
  });

  it("still returns 204 when Supabase auth deletion fails", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSupabaseDeleteUser.mockRejectedValue(new Error("supabase down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await DELETE(makeDeleteRequest("Bearer valid.token"));

    expect(res.status).toBe(204);
    expect(mockUserDelete).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// ─── DELETE — failure ─────────────────────────────────────────────────────────

describe("DELETE /api/user — failure", () => {
  it("returns 500 when Prisma transaction throws", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockTransaction.mockRejectedValue(new Error("DB error"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await DELETE(makeDeleteRequest("Bearer valid.token"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/delete account/i);
    expect(mockSupabaseDeleteUser).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
