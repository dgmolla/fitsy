// Matching, dry run, and batching. Channel and convergence rules are in
// launchNotify.channels.test.ts; fixtures in tests/fixtures/launchNotify.ts.
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
  optedOutAddresses: jest.fn(),
  isUndeliverableAddress: jest.requireActual("@/lib/marketingEmail").isUndeliverableAddress,
  launchEmailContent: jest.fn(() => ({ subject: "Fitsy launched", html: "<p>hi</p>" })),
}));

jest.mock("@/lib/marketingLedger", () => ({
  recordSend: jest.fn(),
  wasSent: jest.fn(),
}));

import { MAX_NOTIFY_ATTEMPTS, MAX_PER_RUN, RETRY_COOLDOWN_MS, milesBetween, notifyLaunch } from "@/lib/launchNotify";
import { prisma } from "@/lib/restaurantService";
import { sendLaunchPush } from "@/lib/launchPush";
import { isEmailOptedOut, optedOutAddresses, sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend, wasSent } from "@/lib/marketingLedger";
import { LA, ONBOARDING_LA, ONBOARDING_NYC, WEB } from "../tests/fixtures/launchNotify";

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
  (optedOutAddresses as jest.Mock).mockResolvedValue(new Set());
  (recordSend as jest.Mock).mockResolvedValue(undefined);
  (wasSent as jest.Mock).mockResolvedValue(false);
});

describe("milesBetween", () => {
  it("is zero for the same point and ~2,450 mi LA to NYC", () => {
    expect(milesBetween(34.05, -118.24, 34.05, -118.24)).toBe(0);
    const d = milesBetween(34.05, -118.24, 40.71, -74.01);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
  });
});


describe("notifyLaunch: matching, dry run, batching", () => {
  it("only considers unnotified rows with attempts left and past the retry cooldown, oldest first", async () => {
    const before = Date.now();
    await notifyLaunch({ ...LA, dryRun: true });
    const arg = (prisma.launchWaitlist.findMany as jest.Mock).mock.calls[0]![0];
    expect(arg.orderBy).toEqual({ createdAt: "asc" });
    expect(arg.where.notifiedAt).toBeNull();
    expect(arg.where.notifyAttempts).toEqual({ lt: MAX_NOTIFY_ATTEMPTS });
    const [never, cooled] = arg.where.OR;
    expect(never).toEqual({ lastNotifyAttemptAt: null });
    const cutoff = (cooled.lastNotifyAttemptAt.lt as Date).getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(RETRY_COOLDOWN_MS - 1000);
    expect(before - cutoff).toBeLessThanOrEqual(RETRY_COOLDOWN_MS + 1000);
    // The literals are the policy: a cooldown of 0 would reintroduce the
    // burn-every-attempt-in-one-run bug, and the attempt cap bounds it.
    expect(RETRY_COOLDOWN_MS).toBe(12 * 3600e3);
    expect(MAX_NOTIFY_ATTEMPTS).toBe(3);
  });

  it("radius-matches located rows and excludes unlocated web rows by default", async () => {
    const res = await notifyLaunch({ ...LA, dryRun: true });
    expect(res).toEqual({ dryRun: true, matched: 1, wouldNotify: 1, wouldSuppress: 0 });
  });

  it("dry run previews the suppressed split in one set query so matched never overstates reach", async () => {
    (optedOutAddresses as jest.Mock).mockResolvedValue(new Set(["web@fitsy.org"]));
    const res = await notifyLaunch({ ...LA, includeUnlocated: true, dryRun: true });
    expect(res).toEqual({ dryRun: true, matched: 2, wouldNotify: 1, wouldSuppress: 1 });
    expect(optedOutAddresses).toHaveBeenCalledWith(["app@fitsy.org", "web@fitsy.org"]);
    expect(isEmailOptedOut).not.toHaveBeenCalled();
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });

  it("dry run counts an opted-out address with a push token as notifiable (push is not gated)", async () => {
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([ONBOARDING_LA]);
    (optedOutAddresses as jest.Mock).mockResolvedValue(new Set(["app@fitsy.org"]));
    const res = await notifyLaunch({ ...LA, dryRun: true });
    expect(res).toEqual({ dryRun: true, matched: 1, wouldNotify: 1, wouldSuppress: 0 });
  });

  it("processes at most MAX_PER_RUN rows and reports the remainder", async () => {
    expect(MAX_PER_RUN).toBe(400);
    const many = Array.from({ length: MAX_PER_RUN + 3 }, (_, i) => ({
      ...WEB,
      id: `wl-${i}`,
      email: `w${i}@fitsy.org`,
    }));
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue(many);
    const res = await notifyLaunch({ ...LA, includeUnlocated: true });
    expect(res).toEqual(
      expect.objectContaining({ matched: MAX_PER_RUN + 3, notified: MAX_PER_RUN, remaining: 3, exhausted: 0 }),
    );
    expect(sendMarketingEmail).toHaveBeenCalledTimes(MAX_PER_RUN);
  });

  it("stops starting rows once the caller's deadline has passed and reports them as remaining", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-11T16:00:00Z"));
    const rows = ["a", "b", "c"].map((n) => ({ ...WEB, id: `wl-${n}`, email: `${n}@fitsy.org` }));
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue(rows);
    // Each send takes 100s against a 150s deadline: the third row is never started.
    (sendMarketingEmail as jest.Mock).mockImplementation(async () => {
      jest.advanceTimersByTime(100_000);
      return true;
    });
    const res = await notifyLaunch({ ...LA, includeUnlocated: true, deadline: Date.now() + 150_000 });
    expect(res).toEqual(expect.objectContaining({ matched: 3, notified: 2, remaining: 1, failed: 0 }));
    expect(sendMarketingEmail).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("honours an explicit radius and falls back to 30 miles for a non-positive one", async () => {
    // ONBOARDING_LA sits ~4 miles from the LA center.
    expect(await notifyLaunch({ ...LA, radiusMiles: 1, dryRun: true })).toEqual(
      expect.objectContaining({ matched: 0 }),
    );
    expect(await notifyLaunch({ ...LA, radiusMiles: 0, dryRun: true })).toEqual(
      expect.objectContaining({ matched: 1 }),
    );
  });

  it("never matches an undeliverable seed address", async () => {
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([
      { ...WEB, id: "wl-seed", email: "seed-1@fitsy.test" },
      WEB,
    ]);
    const res = await notifyLaunch({ ...LA, includeUnlocated: true });
    expect(res).toEqual(expect.objectContaining({ matched: 1, notified: 1 }));
    expect(sendMarketingEmail).not.toHaveBeenCalledWith(expect.objectContaining({ to: "seed-1@fitsy.test" }));
  });

  it("folds unlocated web rows in with includeUnlocated", async () => {
    const res = await notifyLaunch({ ...LA, includeUnlocated: true, dryRun: true });
    expect(res).toEqual({ dryRun: true, matched: 2, wouldNotify: 2, wouldSuppress: 0 });
  });

});
