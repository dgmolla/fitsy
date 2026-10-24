jest.mock("@/lib/auth", () => ({
  requireAuth: jest.fn(),
}));
const mockGetUserById = jest.fn();
jest.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ auth: { admin: { getUserById: mockGetUserById } } }),
}));
const mockAfter = jest.fn();
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: (callback: () => unknown) => mockAfter(callback),
}));

// Interactive transaction: the route receives a tx client and we hand it the
// same mocks so every call inside the callback is observable.
const tx = {
  launchWaitlist: { findUnique: jest.fn(), upsert: jest.fn() },
  user: { updateMany: jest.fn() },
};

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";

const AUTH_OK = { sub: "user-1", email: "Alice@Example.org" };
const LA = { lat: 34.0522, lng: -118.2437, city: "Los Angeles" };
const COARSE_LA = { lat: 34.1, lng: -118.2, city: "Los Angeles" };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function upsertArg(): { create: Record<string, unknown>; update: Record<string, unknown> } {
  return tx.launchWaitlist.upsert.mock.calls[0]![0];
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue(AUTH_OK);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "Alice@Example.org" });
  (prisma.$transaction as jest.Mock).mockImplementation(
    async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  );
  tx.launchWaitlist.findUnique.mockResolvedValue(null);
  tx.launchWaitlist.upsert.mockResolvedValue({ id: "wl1", confirmedAt: new Date() });
  tx.user.updateMany.mockResolvedValue({ count: 0 });
  mockGetUserById.mockResolvedValue({
    data: { user: { id: AUTH_OK.sub, identities: [{
      provider: "google", identity_data: { email: "alice@example.org", email_verified: true },
    }] } },
    error: null,
  });
});

describe("POST /api/waitlist (onboarding)", () => {
  it("keeps a pending website signup unconfirmed for a password account even when Supabase marks its email confirmed", async () => {
    mockGetUserById.mockResolvedValue({
      data: { user: {
        id: AUTH_OK.sub,
        email_confirmed_at: "2026-09-01T00:00:00Z",
        user_metadata: { email_verified: true, provider: "google" },
        identities: [{ provider: "email", identity_data: { email: "alice@example.org", email_verified: true } }],
      } },
      error: null,
    });
    tx.launchWaitlist.findUnique.mockResolvedValue({ lat: null, lng: null, emailOptOutAt: null, confirmedAt: null });
    tx.launchWaitlist.upsert.mockResolvedValue({ id: "wl1", confirmedAt: null });
    expect((await POST(makeRequest(LA))).status).toBe(200);
    expect(upsertArg().create).toHaveProperty("confirmedAt", null);
    expect(upsertArg().update).not.toHaveProperty("confirmedAt");
    expect(mockAfter).toHaveBeenCalledWith(expect.any(Function));
  });

  it("passes through the auth failure response", async () => {
    (requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeRequest({ lat: 34, lng: -118 }));
    expect(res.status).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(makeRequest("{not json"));
    expect(res.status).toBe(400);
  });

  it("rejects missing or out-of-range coordinates", async () => {
    expect((await POST(makeRequest({}))).status).toBe(400);
    expect((await POST(makeRequest({ lat: "34", lng: -118 }))).status).toBe(400);
    expect((await POST(makeRequest({ lat: 91, lng: -118 }))).status).toBe(400);
    expect((await POST(makeRequest({ lat: -91, lng: -118 }))).status).toBe(400);
    expect((await POST(makeRequest({ lat: 34, lng: 181 }))).status).toBe(400);
    expect((await POST(makeRequest({ lat: 34, lng: -181 }))).status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the account no longer exists", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await POST(makeRequest({ lat: 34, lng: -118 }));
    expect(res.status).toBe(404);
  });

  it("first join: creates by normalized email with coarse coords and the account linked", async () => {
    const res = await POST(makeRequest(LA));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(tx.launchWaitlist.findUnique).toHaveBeenCalledWith({
      where: { email: "alice@example.org" },
      select: { lat: true, lng: true, emailOptOutAt: true, confirmedAt: true },
    });
    // The fetched Google identity proves ownership of the stored address.
    expect(tx.launchWaitlist.upsert).toHaveBeenCalledWith({
      where: { email: "alice@example.org" },
      create: {
        email: "alice@example.org",
        userId: "user-1",
        source: "onboarding",
        confirmedAt: expect.any(Date),
        legacyConsent: false,
        ...COARSE_LA,
      },
      update: { userId: "user-1", confirmedAt: expect.any(Date), ...COARSE_LA },
      select: { id: true, confirmedAt: true },
    });
    expect(mockGetUserById).toHaveBeenCalledWith("user-1");
    expect(mockAfter).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it.each(["apple", "google"])("automatically confirms a matching, provider-verified %s identity", async (provider) => {
    mockGetUserById.mockResolvedValue({
      data: { user: { id: AUTH_OK.sub, identities: [{
        provider, identity_data: { email: " Alice@Example.org ", email_verified: true },
      }] } },
      error: null,
    });
    await POST(makeRequest(LA));
    expect(upsertArg().create).toHaveProperty("confirmedAt", expect.any(Date));
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "google", identity_data: { email: "other@example.org", email_verified: true } },
    { provider: "apple", identity_data: { email: "alice@example.org", email_verified: false } },
    { provider: "google", identity_data: { email: "alice@example.org" } },
    { provider: "google", identity_data: { email: "alice@example.org", email_verified: "true" } },
    { provider: "apple", identity_data: { email_verified: true } },
    { provider: "github", identity_data: { email: "alice@example.org", email_verified: true } },
    { provider: "google" },
  ])("requires the signed confirmation flow for untrusted identity %j", async (identity) => {
    mockGetUserById.mockResolvedValue({ data: { user: { id: AUTH_OK.sub, identities: [identity] } }, error: null });
    tx.launchWaitlist.upsert.mockResolvedValue({ id: "wl1", confirmedAt: null });
    await POST(makeRequest(LA));
    expect(upsertArg().create).toHaveProperty("confirmedAt", null);
    expect(upsertArg().update).not.toHaveProperty("confirmedAt");
    expect(mockAfter).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: AUTH_OK.sub } }, error: null },
    { data: { user: { id: "other-user", identities: [{ provider: "google", identity_data: { email: "alice@example.org", email_verified: true } }] } }, error: null },
    { data: { user: null }, error: { message: "Unavailable" } },
  ])("keeps signup pending when ownership lookup cannot establish proof: %j", async (result) => {
    mockGetUserById.mockResolvedValue(result);
    tx.launchWaitlist.upsert.mockResolvedValue({ id: "wl1", confirmedAt: null });
    expect((await POST(makeRequest(LA))).status).toBe(200);
    expect(upsertArg().create).toHaveProperty("confirmedAt", null);
    expect(mockAfter).toHaveBeenCalledTimes(1);
  });

  it("falls back to confirmation email when the ownership lookup throws", async () => {
    mockGetUserById.mockRejectedValue(new Error("Provider unavailable"));
    tx.launchWaitlist.upsert.mockResolvedValue({ id: "wl1", confirmedAt: null });
    expect((await POST(makeRequest(LA))).status).toBe(200);
    expect(upsertArg().update).not.toHaveProperty("confirmedAt");
    expect(mockAfter).toHaveBeenCalledTimes(1);
  });

  it("keeps prior consent when an account without provider proof joins an already confirmed row", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: null }, error: null });
    tx.launchWaitlist.findUnique.mockResolvedValue({ ...COARSE_LA, emailOptOutAt: null, confirmedAt: new Date() });
    await POST(makeRequest(LA));
    expect(upsertArg().update).not.toHaveProperty("confirmedAt");
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("re-tapping from the same place refreshes the row but never resets notifiedAt", async () => {
    tx.launchWaitlist.findUnique.mockResolvedValue({
      lat: 34.1,
      lng: -118.2,
      emailOptOutAt: null,
      confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await POST(makeRequest(LA));
    const { update } = upsertArg();
    // Already confirmed: confirmedAt is left alone.
    expect(update).toEqual({ userId: "user-1", ...COARSE_LA });
    expect(update).not.toHaveProperty("notifiedAt");
    expect(update).not.toHaveProperty("emailOptOutAt");
    expect(update).not.toHaveProperty("source");
  });

  it("a website row gaining its first city is a fresh per-city opt-in: notifiedAt clears", async () => {
    // Bob joined on fitsy.org (no location), was included in the LA launch
    // blast, then asks for Chicago in-app. He must be eligible for Chicago.
    tx.launchWaitlist.findUnique.mockResolvedValue({
      lat: null,
      lng: null,
      emailOptOutAt: null,
      confirmedAt: null,
    });
    await POST(makeRequest({ lat: 41.88, lng: -87.63, city: "Chicago" }));
    const { update } = upsertArg();
    // Linking an account also confirms a pending website row.
    expect(update).toEqual({
      userId: "user-1",
      lat: 41.9,
      lng: -87.6,
      city: "Chicago",
      confirmedAt: expect.any(Date),
      notifiedAt: null,
    });
  });

  it("opting in again from a different city is also a fresh opt-in: notifiedAt clears", async () => {
    // Notified for LA, then moved to Chicago and tapped again.
    tx.launchWaitlist.findUnique.mockResolvedValue({
      lat: 34.1,
      lng: -118.2,
      emailOptOutAt: null,
      confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await POST(makeRequest({ lat: 41.88, lng: -87.63, city: "Chicago" }));
    expect(upsertArg().update).toHaveProperty("notifiedAt", null);
  });

  it("a move along one axis only (same coarse latitude) still counts as a new city", async () => {
    tx.launchWaitlist.findUnique.mockResolvedValue({
      lat: 34.1,
      lng: -118.2,
      emailOptOutAt: null,
      confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await POST(makeRequest({ lat: 34.1, lng: -96.0, city: "Dallas" }));
    expect(upsertArg().update).toHaveProperty("notifiedAt", null);
  });

  it("linking onto a row that already opted out carries the opt-out onto the account", async () => {
    const optedOut = new Date("2026-09-01T00:00:00.000Z");
    tx.launchWaitlist.findUnique.mockResolvedValue({ lat: null, lng: null, emailOptOutAt: optedOut, confirmedAt: null });
    await POST(makeRequest(LA));
    expect(upsertArg().update).not.toHaveProperty("emailOptOutAt");
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", emailOptOutAt: null },
      data: { emailOptOutAt: optedOut },
    });
  });

  it("truncates an over-long city label and stores null for a non-string", async () => {
    await POST(makeRequest({ lat: 34, lng: -118, city: "x".repeat(200) }));
    expect(upsertArg().create["city"]).toHaveLength(80);

    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    );
    (requireAuth as jest.Mock).mockResolvedValue(AUTH_OK);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "a@b.org" });
    await POST(makeRequest({ lat: 34, lng: -118, city: 42 }));
    expect(upsertArg().create["city"]).toBeNull();
  });
});
