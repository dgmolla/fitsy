/**
 * The launch-day route driving the REAL lib/launchNotify (only the
 * external boundary and the database are mocked), so the contract between
 * the drain loop and the result shape is exercised end to end.
 */
jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    launchWaitlist: { findMany: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/launchPush", () => ({ sendLaunchPush: jest.fn() }));
jest.mock("@/lib/marketingEmail", () => ({
  sendMarketingEmail: jest.fn(),
  isEmailOptedOut: jest.fn(async () => false),
  optedOutAddresses: jest.fn(async () => new Set()),
  isUndeliverableAddress: jest.requireActual("@/lib/marketingEmail").isUndeliverableAddress,
  launchEmailContent: jest.fn(() => ({ subject: "s", html: "h" })),
}));
jest.mock("@/lib/marketingLedger", () => ({
  recordSend: jest.fn(),
  wasSent: jest.fn(async () => false),
}));
const mockNotifySlack = jest.fn();
jest.mock("@fitsy/shared", () => ({
  ...jest.requireActual("@fitsy/shared"),
  notifySlack: (...args: unknown[]) => mockNotifySlack(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { LAUNCH_DATE_ISO } from "@/lib/launch";
import { MAX_PER_RUN } from "@/lib/launchNotify";
import { WEB } from "../../../../../tests/fixtures/launchNotify";

const SECRET = "cron-secret";
function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/internal/waitlist/launch-day", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:30:00Z`));
  process.env["CRON_SECRET"] = SECRET;
  mockNotifySlack.mockResolvedValue(undefined);
  (prisma.launchWaitlist.update as jest.Mock).mockResolvedValue({});
});
afterEach(() => {
  jest.useRealTimers();
  delete process.env["CRON_SECRET"];
});

describe("launch-day route with the real notifyLaunch", () => {
  it("a partial provider failure ends the run in one batch with failures reported, no stall", async () => {
    const rows = ["a", "b", "c"].map((n) => ({ ...WEB, id: `wl-${n}`, email: `${n}@fitsy.org` }));
    // The second call models the next tick's view after the cooldown: nothing pending.
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValueOnce(rows).mockResolvedValue([]);
    (sendMarketingEmail as jest.Mock).mockImplementation(async ({ to }: { to: string }) => to !== "b@fitsy.org");
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(prisma.launchWaitlist.findMany).toHaveBeenCalledTimes(1);
    expect(body).toEqual(
      expect.objectContaining({ matched: 3, notified: 2, failed: 1, exhausted: 0, remaining: 0 }),
    );
    expect(body).not.toHaveProperty("stalled");
    expect(prisma.launchWaitlist.update).toHaveBeenCalledWith({
      where: { id: "wl-b" },
      data: { notifyAttempts: 1, lastNotifyAttemptAt: expect.any(Date) },
    });
    expect(mockNotifySlack).toHaveBeenCalledWith("launch blast had failures", expect.stringContaining("failed 1"), { source: "launch-day" });
  });

  it("drains a match larger than one batch across two real calls", async () => {
    const rows = Array.from({ length: MAX_PER_RUN + 2 }, (_, i) => ({ ...WEB, id: `wl-${i}`, email: `w${i}@fitsy.org` }));
    // First call sees everything; the second sees what the first left unprocessed.
    (prisma.launchWaitlist.findMany as jest.Mock)
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(rows.slice(MAX_PER_RUN));
    (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
    const body = await (await GET(makeRequest())).json();
    expect(prisma.launchWaitlist.findMany).toHaveBeenCalledTimes(2);
    expect(body).toEqual(
      expect.objectContaining({ matched: MAX_PER_RUN + 2, notified: MAX_PER_RUN + 2, failed: 0, remaining: 0 }),
    );
    expect(body).not.toHaveProperty("stalled");
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("a clean run over the whole match reports nothing to Slack", async () => {
    (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([{ ...WEB }]);
    (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
    const body = await (await GET(makeRequest())).json();
    expect(body).toEqual(expect.objectContaining({ notified: 1, failed: 0, remaining: 0 }));
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });
});
