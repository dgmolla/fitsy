jest.mock("@/lib/launchNotify", () => ({
  notifyLaunch: jest.fn(),
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
  });
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env["CRON_SECRET"];
});

describe("GET /api/internal/waitlist/launch-day", () => {
  it("requires the CRON_SECRET bearer", async () => {
    expect((await GET(makeRequest("", null))).status).toBe(401);
    expect((await GET(makeRequest("", "Bearer nope"))).status).toBe(401);
    expect(notifyLaunch).not.toHaveBeenCalled();
  });

  it("is a no-op on any day but the launch date", async () => {
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
  });

  it("supports a dry run on launch day", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T02:00:00Z`));
    (notifyLaunch as jest.Mock).mockResolvedValue({ dryRun: true, matched: 3, wouldNotify: 3, wouldSuppress: 0 });
    await GET(makeRequest("?dryRun=1"));
    expect(notifyLaunch).toHaveBeenCalledTimes(1);
    expect(notifyLaunch).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it("drains the blast in batches while rows remain and sums the counts", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    const batch = (notified: number, remaining: number) => ({
      dryRun: false,
      matched: 5,
      viaPush: 0,
      viaEmail: notified,
      notified,
      suppressed: 0,
      failed: 0,
      remaining,
    });
    (notifyLaunch as jest.Mock)
      .mockResolvedValueOnce(batch(2, 3))
      .mockResolvedValueOnce(batch(2, 1))
      .mockResolvedValueOnce(batch(1, 0));
    const res = await GET(makeRequest());
    expect(notifyLaunch).toHaveBeenCalledTimes(3);
    expect(await res.json()).toEqual(
      expect.objectContaining({ matched: 5, viaEmail: 5, notified: 5, remaining: 0 }),
    );
  });

  it("stops draining when a batch makes no progress instead of spinning until the time budget", async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${LAUNCH_DATE_ISO}T16:00:00Z`));
    const stuck = { dryRun: false, matched: 5, viaPush: 0, viaEmail: 0, notified: 0, suppressed: 0, failed: 3, remaining: 3 };
    (notifyLaunch as jest.Mock)
      .mockResolvedValueOnce({ ...stuck, viaEmail: 2, notified: 2, failed: 0 })
      .mockResolvedValue(stuck);
    const res = await GET(makeRequest());
    expect(notifyLaunch).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual(
      expect.objectContaining({ notified: 2, failed: 0, remaining: 3 }),
    );
  });
});
