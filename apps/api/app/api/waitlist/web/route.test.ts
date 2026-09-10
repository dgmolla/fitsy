jest.mock("@/lib/rateLimit", () => ({
  waitlistLimiter: { check: jest.fn() },
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    launchWaitlist: { upsert: jest.fn() },
  },
}));

jest.mock("@/lib/waitlistConfirmSend", () => ({
  sendWaitlistConfirmation: jest.fn(),
}));

// after() needs the Next.js request context, which jest lacks. Run the
// callback immediately so the deferred confirmation send is observable.
const mockAfter = jest.fn((cb: () => unknown) => {
  void cb();
});
jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    after: (cb: () => unknown) => mockAfter(cb),
  };
});

import { POST } from "./route";
import { NextRequest } from "next/server";
import { waitlistLimiter } from "@/lib/rateLimit";
import { prisma } from "@/lib/restaurantService";
import { sendWaitlistConfirmation } from "@/lib/waitlistConfirmSend";

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
  (prisma.launchWaitlist.upsert as jest.Mock).mockResolvedValue({ id: "wl-new", confirmedAt: null });
  (sendWaitlistConfirmation as jest.Mock).mockResolvedValue(true);
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

  it("falls back to x-real-ip, then a shared bucket, for the rate-limit key", async () => {
    await POST(makeRequest({ email: "a@b.com" }, { "x-real-ip": "203.0.113.7" }));
    expect(waitlistLimiter.check).toHaveBeenLastCalledWith("203.0.113.7");
    await POST(makeRequest({ email: "a@b.com" }));
    expect(waitlistLimiter.check).toHaveBeenLastCalledWith("unknown");
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
    const res = await POST(makeRequest({ email: "bot@spam.com", hp: "http://spam" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.launchWaitlist.upsert).not.toHaveBeenCalled();
    expect(sendWaitlistConfirmation).not.toHaveBeenCalled();
  });

  it("stores a normalized web signup and leaves an existing row untouched", async () => {
    const res = await POST(makeRequest({ email: "  Dawit@Gmail.com ", hp: "" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.launchWaitlist.upsert).toHaveBeenCalledWith({
      where: { email: "dawit@gmail.com" },
      create: { email: "dawit@gmail.com", source: "web", confirmedAt: null, legacyConsent: false },
      update: {},
      select: { id: true, confirmedAt: true },
    });
  });

  it("hands the double opt-in confirmation for an unconfirmed row to after()", async () => {
    await POST(makeRequest({ email: "dawit@gmail.com" }));
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(sendWaitlistConfirmation).toHaveBeenCalledWith({ id: "wl-new", email: "dawit@gmail.com" });
  });

  it("sends nothing for an address that is already confirmed", async () => {
    (prisma.launchWaitlist.upsert as jest.Mock).mockResolvedValue({
      id: "wl-old",
      confirmedAt: new Date(),
    });
    const res = await POST(makeRequest({ email: "dawit@gmail.com" }));
    expect(res.status).toBe(200);
    expect(sendWaitlistConfirmation).not.toHaveBeenCalled();
  });
});
