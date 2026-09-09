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

jest.mock("@/lib/marketingLedger", () => ({
  recordSend: jest.fn(),
}));

import { MAX_PER_RUN, milesBetween, notifyLaunch } from "@/lib/launchNotify";
import { prisma } from "@/lib/restaurantService";
import { sendLaunchPush } from "@/lib/launchPush";
import { isEmailOptedOut, sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend } from "@/lib/marketingLedger";

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

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([
    ONBOARDING_LA,
    ONBOARDING_NYC,
    WEB,
  ]);
  (prisma.launchWaitlist.update as jest.Mock).mockResolvedValue({});
  (sendLaunchPush as jest.Mock).mockResolvedValue(true);
  (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
  (isEmailOptedOut as jest.Mock).mockResolvedValue(false);
  (recordSend as jest.Mock).mockResolvedValue(undefined);
});

describe("milesBetween", () => {
  it("is zero for the same point and ~2,450 mi LA to NYC", () => {
    expect(milesBetween(34.05, -118.24, 34.05, -118.24)).toBe(0);
    const d = milesBetween(34.05, -118.24, 40.71, -74.01);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
  });
});

describe("notifyLaunch", () => {

  it("only considers unnotified rows; opt-out is decided per address at send time", async () => {
    await notifyLaunch({ ...LA, dryRun: true });
    expect(prisma.launchWaitlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { notifiedAt: null } }),
    );
  });

  it("radius-matches located rows and excludes unlocated web rows by default", async () => {
    const res = await notifyLaunch({ ...LA, dryRun: true });
    expect(res).toEqual({ dryRun: true, matched: 1, wouldNotify: 1, wouldSuppress: 0 });
  });

  it("dry run previews the suppressed split so matched never overstates reach", async () => {
    (isEmailOptedOut as jest.Mock).mockImplementation(async (email: string) => email === "web@fitsy.org");
    const res = await notifyLaunch({ ...LA, includeUnlocated: true, dryRun: true });
    expect(res).toEqual({ dryRun: true, matched: 2, wouldNotify: 1, wouldSuppress: 1 });
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });

  it("dry run counts an opted-out address with a push token as notifiable (push is not gated)", async () => {
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([ONBOARDING_LA]);
    (isEmailOptedOut as jest.Mock).mockResolvedValue(true);
    const res = await notifyLaunch({ ...LA, dryRun: true });
    expect(res).toEqual({ dryRun: true, matched: 1, wouldNotify: 1, wouldSuppress: 0 });
  });

  it("processes at most MAX_PER_RUN rows and reports the remainder", async () => {
    const many = Array.from({ length: MAX_PER_RUN + 3 }, (_, i) => ({
      ...WEB,
      id: `wl-${i}`,
      email: `w${i}@fitsy.org`,
    }));
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue(many);
    const res = await notifyLaunch({ ...LA, includeUnlocated: true });
    expect(res).toEqual(
      expect.objectContaining({ matched: MAX_PER_RUN + 3, notified: MAX_PER_RUN, remaining: 3 }),
    );
    expect(sendMarketingEmail).toHaveBeenCalledTimes(MAX_PER_RUN);
  });

  it("folds unlocated web rows in with includeUnlocated", async () => {
    const res = await notifyLaunch({ ...LA, includeUnlocated: true, dryRun: true });
    expect(res).toEqual({ dryRun: true, matched: 2, wouldNotify: 2, wouldSuppress: 0 });
  });

  it("notifies an account-linked row by push and email keyed on the user", async () => {
    const res = await notifyLaunch({ ...LA, city: "LA" });
    expect(res).toEqual({
      dryRun: false,
      matched: 1,
      viaPush: 1,
      viaEmail: 1,
      notified: 1,
      suppressed: 0,
      failed: 0,
      remaining: 0,
    });
    expect(isEmailOptedOut).toHaveBeenCalledWith("app@fitsy.org");
    expect(recordSend).toHaveBeenCalledWith("app@fitsy.org", "launch", "LA");
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
    const res = await notifyLaunch({ ...LA, includeUnlocated: true });
    expect(res).toEqual({
      dryRun: false,
      matched: 1,
      viaPush: 0,
      viaEmail: 1,
      notified: 1,
      suppressed: 0,
      failed: 0,
      remaining: 0,
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
    const res = await notifyLaunch(LA);
    expect(res).toEqual(
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
    const res = await notifyLaunch(LA);
    expect(res).toEqual(
      expect.objectContaining({ viaPush: 1, viaEmail: 0, notified: 1, suppressed: 0, failed: 0 }),
    );
    expect(sendMarketingEmail).not.toHaveBeenCalled();
    expect(recordSend).not.toHaveBeenCalled();
    // No city given: the row's own label is used.
    expect(sendLaunchPush).toHaveBeenCalledWith("ExponentPushToken[abc]", "Los Angeles");
  });

  it("live web row with no push token whose email fails is left for retry, not closed", async () => {
    // Only an opted-out row may be closed without a delivery; a transient
    // provider failure must keep the row eligible for the next run.
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([WEB]);
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    const res = await notifyLaunch({ ...LA, includeUnlocated: true });
    expect(res).toEqual(
      expect.objectContaining({ matched: 1, notified: 0, suppressed: 0, failed: 1 }),
    );
    expect(prisma.launchWaitlist.update).not.toHaveBeenCalled();
  });

  it("opted out with no push token: nothing may be sent, so the row is closed as suppressed", async () => {
    // Converges: without this the row would be re-matched and counted as
    // failed on every future launch run.
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([WEB]);
    (isEmailOptedOut as jest.Mock).mockResolvedValue(true);
    const res = await notifyLaunch({ ...LA, includeUnlocated: true });
    expect(res).toEqual(
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
    const res = await notifyLaunch(LA);
    expect(res).toEqual(
      expect.objectContaining({ matched: 1, notified: 0, failed: 1 }),
    );
    expect(prisma.launchWaitlist.update).not.toHaveBeenCalled();
  });
});
