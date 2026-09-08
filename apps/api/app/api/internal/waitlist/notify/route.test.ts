jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    launchWaitlist: { findMany: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/launchPush", () => ({
  sendLaunchPush: jest.fn(),
}));

jest.mock("@/lib/marketingEmail", () => ({
  sendMarketingEmail: jest.fn(),
  isEmailOptedOut: jest.fn(),
  launchEmailContent: jest.fn(() => ({ subject: "Fitsy launched", html: "<p>hi</p>" })),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { sendLaunchPush } from "@/lib/launchPush";
import { isEmailOptedOut, sendMarketingEmail } from "@/lib/marketingEmail";

const SECRET = "cron-secret";
const LA = { lat: 34.05, lng: -118.24 };

// Onboarding row: account-linked, coarse LA location.
const ONBOARDING_LA = {
  id: "wl-app",
  userId: "user-1",
  email: "app@fitsy.org",
  lat: 34.1,
  lng: -118.2,
  city: "Los Angeles",
  user: { pushToken: "ExponentPushToken[abc]" },
};

// Onboarding row far away (NYC).
const ONBOARDING_NYC = {
  ...ONBOARDING_LA,
  id: "wl-nyc",
  userId: "user-2",
  email: "nyc@fitsy.org",
  lat: 40.7,
  lng: -74.0,
  city: "New York",
};

// Account-linked row in LA whose user never granted push permission.
const ONBOARDING_NO_TOKEN = {
  ...ONBOARDING_LA,
  id: "wl-notoken",
  userId: "user-3",
  email: "notoken@fitsy.org",
  user: { pushToken: null },
};

// Website row: no account, no location.
const WEB = {
  id: "wl-web",
  userId: null,
  email: "web@fitsy.org",
  lat: null,
  lng: null,
  city: null,
  user: null,
};

function makeRequest(body: unknown, auth: string | null = `Bearer ${SECRET}`): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["authorization"] = auth;
  return new NextRequest("http://localhost/api/internal/waitlist/notify", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env["CRON_SECRET"] = SECRET;
  (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([
    ONBOARDING_LA,
    ONBOARDING_NYC,
    WEB,
  ]);
  (prisma.launchWaitlist.update as jest.Mock).mockResolvedValue({});
  (sendLaunchPush as jest.Mock).mockResolvedValue(true);
  (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
  (isEmailOptedOut as jest.Mock).mockResolvedValue(false);
});

afterEach(() => {
  delete process.env["CRON_SECRET"];
});

describe("POST /api/internal/waitlist/notify", () => {
  it("requires the CRON_SECRET bearer", async () => {
    expect((await POST(makeRequest(LA, null))).status).toBe(401);
    expect((await POST(makeRequest(LA, "Bearer wrong"))).status).toBe(401);
    delete process.env["CRON_SECRET"];
    expect((await POST(makeRequest(LA))).status).toBe(401);
  });

  it("rejects invalid JSON and a missing launch center", async () => {
    expect((await POST(makeRequest("{nope"))).status).toBe(400);
    expect((await POST(makeRequest({ lat: 34 }))).status).toBe(400);
  });

  it("only considers unnotified rows; opt-out is decided per address at send time", async () => {
    await POST(makeRequest({ ...LA, dryRun: true }));
    expect(prisma.launchWaitlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { notifiedAt: null } }),
    );
  });

  it("radius-matches located rows and excludes unlocated web rows by default", async () => {
    const res = await POST(makeRequest({ ...LA, dryRun: true }));
    expect(await res.json()).toEqual({ ok: true, dryRun: true, matched: 1 });
  });

  it("folds unlocated web rows in with includeUnlocated", async () => {
    const res = await POST(makeRequest({ ...LA, includeUnlocated: true, dryRun: true }));
    expect(await res.json()).toEqual({ ok: true, dryRun: true, matched: 2 });
  });

  it("notifies an account-linked row by push and email keyed on the user", async () => {
    const res = await POST(makeRequest({ ...LA, city: "LA" }));
    expect(await res.json()).toEqual({
      ok: true,
      matched: 1,
      viaPush: 1,
      viaEmail: 1,
      notified: 1,
      suppressed: 0,
      failed: 0,
    });
    expect(isEmailOptedOut).toHaveBeenCalledWith("app@fitsy.org");
    expect(sendLaunchPush).toHaveBeenCalledWith("ExponentPushToken[abc]", "LA");
    expect(sendMarketingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", to: "app@fitsy.org" }),
    );
    expect(prisma.launchWaitlist.update).toHaveBeenCalledWith({
      where: { id: "wl-app" },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it("notifies a web-only row by email keyed on the waitlist row, with no push", async () => {
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([WEB]);
    const res = await POST(makeRequest({ ...LA, includeUnlocated: true }));
    expect(await res.json()).toEqual({
      ok: true,
      matched: 1,
      viaPush: 0,
      viaEmail: 1,
      notified: 1,
      suppressed: 0,
      failed: 0,
    });
    expect(sendLaunchPush).not.toHaveBeenCalled();
    expect(sendMarketingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ waitlistId: "wl-web", to: "web@fitsy.org" }),
    );
    const sent = (sendMarketingEmail as jest.Mock).mock.calls[0]![0];
    expect(sent).not.toHaveProperty("userId");
  });

  it("account without a push token: no push attempt, email alone marks the row notified", async () => {
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([ONBOARDING_NO_TOKEN]);
    const res = await POST(makeRequest(LA));
    expect(await res.json()).toEqual(
      expect.objectContaining({ matched: 1, viaPush: 0, viaEmail: 1, notified: 1, failed: 0 }),
    );
    expect(sendLaunchPush).not.toHaveBeenCalled();
    expect(prisma.launchWaitlist.update).toHaveBeenCalledWith({
      where: { id: "wl-notoken" },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it("email opt-out suppresses the email only: the requested launch push still goes out", async () => {
    // They tapped "Notify me at launch" and later unsubscribed from the weekly
    // editorial. Unsubscribing stops marketing email, not this notification.
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([ONBOARDING_LA]);
    (isEmailOptedOut as jest.Mock).mockResolvedValue(true);
    const res = await POST(makeRequest(LA));
    expect(await res.json()).toEqual(
      expect.objectContaining({ viaPush: 1, viaEmail: 0, notified: 1, suppressed: 0, failed: 0 }),
    );
    expect(sendMarketingEmail).not.toHaveBeenCalled();
    // No city in the body: the row's own label is used.
    expect(sendLaunchPush).toHaveBeenCalledWith("ExponentPushToken[abc]", "Los Angeles");
  });

  it("live web row with no push token whose email fails is left for retry, not closed", async () => {
    // Only an opted-out row may be closed without a delivery; a transient
    // provider failure must keep the row eligible for the next run.
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([WEB]);
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    const res = await POST(makeRequest({ ...LA, includeUnlocated: true }));
    expect(await res.json()).toEqual(
      expect.objectContaining({ matched: 1, notified: 0, suppressed: 0, failed: 1 }),
    );
    expect(prisma.launchWaitlist.update).not.toHaveBeenCalled();
  });

  it("opted out with no push token: nothing may be sent, so the row is closed as suppressed", async () => {
    // Converges: without this the row would be re-matched and counted as
    // failed on every future launch run.
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([WEB]);
    (isEmailOptedOut as jest.Mock).mockResolvedValue(true);
    const res = await POST(makeRequest({ ...LA, includeUnlocated: true }));
    expect(await res.json()).toEqual(
      expect.objectContaining({ matched: 1, notified: 0, suppressed: 1, failed: 0 }),
    );
    expect(sendMarketingEmail).not.toHaveBeenCalled();
    expect(sendLaunchPush).not.toHaveBeenCalled();
    expect(prisma.launchWaitlist.update).toHaveBeenCalledWith({
      where: { id: "wl-web" },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it("leaves notifiedAt unset when both channels fail", async () => {
    (sendLaunchPush as jest.Mock).mockResolvedValue(false);
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    const res = await POST(makeRequest(LA));
    expect(await res.json()).toEqual(
      expect.objectContaining({ matched: 1, notified: 0, failed: 1 }),
    );
    expect(prisma.launchWaitlist.update).not.toHaveBeenCalled();
  });
});
