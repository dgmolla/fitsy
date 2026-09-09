// Channel and convergence rules (push vs email, opt-out, terminal states).
// Matching and batching are in launchNotify.test.ts.
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
  isUndeliverableAddress: jest.requireActual("@/lib/marketingEmail").isUndeliverableAddress,
  launchEmailContent: jest.fn(() => ({ subject: "Fitsy launched", html: "<p>hi</p>" })),
}));

jest.mock("@/lib/marketingLedger", () => ({
  recordSend: jest.fn(),
  wasSent: jest.fn(),
}));

import { notifyLaunch } from "@/lib/launchNotify";
import { prisma } from "@/lib/restaurantService";
import { sendLaunchPush } from "@/lib/launchPush";
import { isEmailOptedOut, sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend, wasSent } from "@/lib/marketingLedger";
import { LA, ONBOARDING_LA, ONBOARDING_NO_TOKEN, ONBOARDING_NYC, WEB } from "../tests/fixtures/launchNotify";

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
  (wasSent as jest.Mock).mockResolvedValue(false);
});

describe("notifyLaunch: channels and convergence", () => {
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
    // No city anywhere: the ledger step falls back to "launch".
    expect(recordSend).toHaveBeenCalledWith("web@fitsy.org", "launch", "launch");
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
      expect.objectContaining({ matched: 1, notified: 0, suppressed: 0, failed: 1, remaining: 1 }),
    );
    expect(prisma.launchWaitlist.update).not.toHaveBeenCalled();
  });

  it("opted out with a push token whose push fails: closed as suppressed, never retried", async () => {
    // Push was the only allowed channel and it failed (stale token); there
    // is nothing else we may ever send, so the row must not starve the loop.
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([ONBOARDING_LA]);
    (isEmailOptedOut as jest.Mock).mockResolvedValue(true);
    (sendLaunchPush as jest.Mock).mockResolvedValue(false);
    const res = await notifyLaunch(LA);
    expect(res).toEqual(
      expect.objectContaining({ matched: 1, notified: 0, suppressed: 1, failed: 0, remaining: 0 }),
    );
    expect(prisma.launchWaitlist.update).toHaveBeenCalledWith({
      where: { id: "wl-app" },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it("a ledger hit for the launch email short-circuits the send and still closes the row", async () => {
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([WEB]);
    (wasSent as jest.Mock).mockResolvedValue(true);
    const res = await notifyLaunch({ ...LA, includeUnlocated: true, city: "LA" });
    expect(wasSent).toHaveBeenCalledWith("web@fitsy.org", "launch", "LA");
    expect(sendMarketingEmail).not.toHaveBeenCalled();
    expect(recordSend).not.toHaveBeenCalled();
    expect(res).toEqual(expect.objectContaining({ viaEmail: 1, notified: 1, failed: 0 }));
  });

  it("remaining counts unprocessed rows plus this batch's failures", async () => {
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([WEB]);
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    const res = await notifyLaunch({ ...LA, includeUnlocated: true });
    expect(res).toEqual(expect.objectContaining({ failed: 1, remaining: 1 }));
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
