jest.mock("@/lib/launchNotify", () => ({
  notifyLaunch: jest.fn(),
}));

const mockNotifySlack = jest.fn();
jest.mock("@fitsy/shared", () => ({
  ...jest.requireActual("@fitsy/shared"),
  notifySlack: (...args: unknown[]) => mockNotifySlack(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { notifyLaunch } from "@/lib/launchNotify";
import { LAUNCH_CENTER, LAUNCH_CITY, LAUNCH_DATE_ISO } from "@/lib/launch";

const SECRET = "cron-secret";

function makeRequest(qs = "", auth: string | null = `Bearer ${SECRET}`): NextRequest {
  const headers: Record<string, string> = {};
  if (auth) headers["authorization"] = auth;
  return new NextRequest(`http://localhost/api/internal/waitlist/launch-day${qs}`, { headers });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockNotifySlack.mockResolvedValue(undefined);
  process.env["CRON_SECRET"] = SECRET;
  (notifyLaunch as jest.Mock).mockResolvedValue({
    dryRun: false,
    matched: 3,
    viaPush: 1,
    viaEmail: 3,
    notified: 3,
    suppressed: 0,
    failed: 0,
    remaining: 0,
    exhausted: 0,
  });
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env["CRON_SECRET"];
});

describe("GET /api/internal/waitlist/launch-day", () => {
  it("requires the CRON_SECRET bearer, even on launch day", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    expect((await GET(makeRequest("", null))).status).toBe(401);
    expect((await GET(makeRequest("", "Bearer nope"))).status).toBe(401);
    expect(notifyLaunch).not.toHaveBeenCalled();
  });

  it("is a no-op before the launch date", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-10T16:00:00Z"));
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual({
      ok: true,
      skipped: true,
      today: "2026-09-10",
      launchDate: LAUNCH_DATE_ISO,
    });
    expect(notifyLaunch).not.toHaveBeenCalled();
  });

  it("runs again on later days so a truncated blast and post-launch signups are picked up", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-13T16:00:00Z"));
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(expect.objectContaining({ ok: true, notified: 3 }));
    expect(notifyLaunch).toHaveBeenCalledTimes(1);
  });

  it("on launch day blasts the launch radius plus every unlocated website signup", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(
      expect.objectContaining({ ok: true, launchDate: LAUNCH_DATE_ISO, notified: 3 }),
    );
    expect(notifyLaunch).toHaveBeenCalledWith({
      ...LAUNCH_CENTER,
      city: LAUNCH_CITY,
      includeUnlocated: true,
      dryRun: false,
    });
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("supports a dry run on launch day", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T02:00:00Z`));
    (notifyLaunch as jest.Mock).mockResolvedValue({ dryRun: true, matched: 3, wouldNotify: 3, wouldSuppress: 0 });
    const res = await GET(makeRequest("?dryRun=1"));
    expect(notifyLaunch).toHaveBeenCalledTimes(1);
    expect(notifyLaunch).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(await res.json()).toEqual({
      ok: true,
      launchDate: LAUNCH_DATE_ISO,
      dryRun: true,
      matched: 3,
      wouldNotify: 3,
      wouldSuppress: 0,
    });
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("drains the blast in batches: matched from the first, failed from the last, the rest summed", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    (notifyLaunch as jest.Mock)
      .mockResolvedValueOnce({ dryRun: false, matched: 9, viaPush: 1, viaEmail: 2, notified: 2, suppressed: 1, failed: 2, remaining: 4, exhausted: 1 })
      .mockResolvedValueOnce({ dryRun: false, matched: 4, viaPush: 2, viaEmail: 3, notified: 4, suppressed: 1, failed: 1, remaining: 0, exhausted: 0 });
    const res = await GET(makeRequest());
    expect(notifyLaunch).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({
      ok: true,
      launchDate: LAUNCH_DATE_ISO,
      dryRun: false,
      matched: 9, // the full match count, from the first batch
      viaPush: 3,
      viaEmail: 5,
      notified: 6,
      suppressed: 2,
      failed: 1, // failed rows are retried every batch: last batch, not a sum
      remaining: 0,
      exhausted: 1,
    });
  });

  it("a batch that only closes rows as suppressed still counts as progress, not a stall", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    (notifyLaunch as jest.Mock)
      .mockResolvedValueOnce({ dryRun: false, matched: 4, viaPush: 0, viaEmail: 2, notified: 2, suppressed: 0, failed: 0, remaining: 2, exhausted: 0 })
      .mockResolvedValueOnce({ dryRun: false, matched: 2, viaPush: 0, viaEmail: 0, notified: 0, suppressed: 2, failed: 0, remaining: 0, exhausted: 0 });
    const res = await GET(makeRequest());
    expect(notifyLaunch).toHaveBeenCalledTimes(2);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ notified: 2, suppressed: 2, remaining: 0 }));
    expect(body).not.toHaveProperty("stalled");
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("stops at the time budget with rows remaining and no stalled flag", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    const progressing = { dryRun: false, matched: 900, viaPush: 0, viaEmail: 400, notified: 400, suppressed: 0, failed: 0, remaining: 500, exhausted: 0 };
    (notifyLaunch as jest.Mock)
      .mockResolvedValueOnce(progressing)
      .mockImplementationOnce(async () => {
        jest.advanceTimersByTime(210_000);
        return { ...progressing, remaining: 100 };
      });
    const res = await GET(makeRequest());
    expect(notifyLaunch).toHaveBeenCalledTimes(2);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ notified: 800, remaining: 100 }));
    expect(body).not.toHaveProperty("stalled");
    // Incomplete is not silent: the leftover is reported, distinct from a stall.
    expect(mockNotifySlack).toHaveBeenCalledWith(
      "launch blast incomplete",
      expect.stringContaining("remaining 100"),
      { source: "launch-day" },
    );
  });

  it("stops draining when a batch makes no progress instead of spinning until the time budget", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    const stuck = { dryRun: false, matched: 5, viaPush: 0, viaEmail: 0, notified: 0, suppressed: 0, failed: 3, remaining: 3, exhausted: 0 };
    (notifyLaunch as jest.Mock)
      .mockResolvedValueOnce({ ...stuck, viaEmail: 2, notified: 2, failed: 0 })
      .mockResolvedValue(stuck);
    const res = await GET(makeRequest());
    expect(notifyLaunch).toHaveBeenCalledTimes(2);
    // The stalled batch's own failure count is reported, not dropped.
    expect(await res.json()).toEqual(
      expect.objectContaining({ notified: 2, failed: 3, remaining: 3, stalled: true }),
    );
    // Unattended cron: a human hears about it.
    expect(mockNotifySlack).toHaveBeenCalledWith(
      "launch blast stalled",
      expect.stringMatching(/failed 3, .*remaining 3/),
      { source: "launch-day" },
    );
  });

  it("alerts when rows were exhausted even with no retryable failures", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    (notifyLaunch as jest.Mock).mockResolvedValue({
      dryRun: false, matched: 3, viaPush: 0, viaEmail: 1, notified: 1, suppressed: 0, failed: 0, remaining: 0, exhausted: 2,
    });
    await GET(makeRequest());
    expect(mockNotifySlack).toHaveBeenCalledWith(
      "launch blast had failures",
      expect.stringContaining("exhausted 2"),
      { source: "launch-day" },
    );
  });

  it("alerts on failures even when the run did not stall", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    // Two batches, both with a failure; the second finishes the drain.
    (notifyLaunch as jest.Mock)
      .mockResolvedValueOnce({ dryRun: false, matched: 3, viaPush: 0, viaEmail: 1, notified: 1, suppressed: 0, failed: 1, remaining: 2, exhausted: 0 })
      .mockResolvedValueOnce({ dryRun: false, matched: 3, viaPush: 0, viaEmail: 1, notified: 1, suppressed: 0, failed: 1, remaining: 0, exhausted: 0 });
    await GET(makeRequest());
    expect(mockNotifySlack).toHaveBeenCalledWith(
      "launch blast had failures",
      expect.stringContaining("failed 1"),
      { source: "launch-day" },
    );
  });
});
