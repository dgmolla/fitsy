jest.mock("@/lib/auth", () => ({
  requireAuth: jest.fn(),
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    launchWaitlist: { upsert: jest.fn() },
  },
}));

import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";

const AUTH_OK = { sub: "user-1", email: "Alice@Example.org" };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue(AUTH_OK);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "Alice@Example.org" });
  (prisma.launchWaitlist.upsert as jest.Mock).mockResolvedValue({});
});

describe("POST /api/waitlist (onboarding)", () => {
  it("passes through the auth failure response", async () => {
    (requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeRequest({ lat: 34, lng: -118 }));
    expect(res.status).toBe(401);
    expect(prisma.launchWaitlist.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(makeRequest("{not json"));
    expect(res.status).toBe(400);
  });

  it("rejects missing or out-of-range coordinates", async () => {
    expect((await POST(makeRequest({}))).status).toBe(400);
    expect((await POST(makeRequest({ lat: "34", lng: -118 }))).status).toBe(400);
    expect((await POST(makeRequest({ lat: 91, lng: -118 }))).status).toBe(400);
    expect((await POST(makeRequest({ lat: 34, lng: 181 }))).status).toBe(400);
    expect(prisma.launchWaitlist.upsert).not.toHaveBeenCalled();
  });

  it("returns 404 when the account no longer exists", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await POST(makeRequest({ lat: 34, lng: -118 }));
    expect(res.status).toBe(404);
  });

  it("upserts by normalized email with coarse coords, linking the account", async () => {
    const res = await POST(
      makeRequest({ lat: 34.0522, lng: -118.2437, city: "Los Angeles" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const location = { lat: 34.1, lng: -118.2, city: "Los Angeles" };
    expect(prisma.launchWaitlist.upsert).toHaveBeenCalledWith({
      where: { email: "alice@example.org" },
      create: { email: "alice@example.org", userId: "user-1", source: "onboarding", ...location },
      update: { userId: "user-1", ...location },
    });
  });

  it("never resets notifiedAt or emailOptOutAt on a repeat join", async () => {
    await POST(makeRequest({ lat: 34, lng: -118 }));
    const call = (prisma.launchWaitlist.upsert as jest.Mock).mock.calls[0]![0];
    expect(call.update).not.toHaveProperty("notifiedAt");
    expect(call.update).not.toHaveProperty("emailOptOutAt");
    expect(call.update).not.toHaveProperty("source");
  });

  it("truncates an over-long city label and stores null for a non-string", async () => {
    await POST(makeRequest({ lat: 34, lng: -118, city: "x".repeat(200) }));
    let call = (prisma.launchWaitlist.upsert as jest.Mock).mock.calls[0]![0];
    expect(call.create.city).toHaveLength(80);

    await POST(makeRequest({ lat: 34, lng: -118, city: 42 }));
    call = (prisma.launchWaitlist.upsert as jest.Mock).mock.calls[1]![0];
    expect(call.create.city).toBeNull();
  });
});
