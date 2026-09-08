jest.mock("@/lib/rateLimit", () => ({
  waitlistLimiter: { check: jest.fn() },
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    launchWaitlist: { upsert: jest.fn() },
  },
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { waitlistLimiter } from "@/lib/rateLimit";
import { prisma } from "@/lib/restaurantService";

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/waitlist/web", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (waitlistLimiter.check as jest.Mock).mockReturnValue({ ok: true, remaining: 4, retryAfterMs: 0 });
  (prisma.launchWaitlist.upsert as jest.Mock).mockResolvedValue({});
});

describe("POST /api/waitlist/web (public form)", () => {
  it("rate limits per forwarded IP with a Retry-After header", async () => {
    (waitlistLimiter.check as jest.Mock).mockReturnValue({
      ok: false,
      remaining: 0,
      retryAfterMs: 61_000,
    });
    const res = await POST(
      makeRequest({ email: "a@b.com" }, { "x-forwarded-for": "203.0.113.9, 198.51.100.1" }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("61");
    expect(waitlistLimiter.check).toHaveBeenCalledWith("203.0.113.9");
    expect(prisma.launchWaitlist.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    expect((await POST(makeRequest("{nope"))).status).toBe(400);
  });

  it("rejects missing, malformed, and undeliverable emails", async () => {
    for (const body of [{}, { email: 5 }, { email: "not-an-email" }, { email: "seed@fitsy.test" }]) {
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Enter a valid email" });
    }
    expect(prisma.launchWaitlist.upsert).not.toHaveBeenCalled();
  });

  it("silently drops honeypot submissions with a 200", async () => {
    const res = await POST(makeRequest({ email: "bot@spam.com", website: "http://spam" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.launchWaitlist.upsert).not.toHaveBeenCalled();
  });

  it("stores a normalized web signup and leaves an existing row untouched", async () => {
    const res = await POST(makeRequest({ email: "  Dawit@Gmail.com ", website: "" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.launchWaitlist.upsert).toHaveBeenCalledWith({
      where: { email: "dawit@gmail.com" },
      create: { email: "dawit@gmail.com", source: "web" },
      update: {},
    });
  });
});
