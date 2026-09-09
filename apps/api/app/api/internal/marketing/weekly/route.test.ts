jest.mock("@/lib/marketingEmail", () => ({
  sendMarketingEmail: jest.fn(),
}));

jest.mock("@/lib/emailTemplates", () => ({
  editionForDate: jest.fn(() => ({ slug: "ed-1", subject: "S", html: "<p>h</p>" })),
  weekIndexForDate: jest.fn(() => 35),
}));

jest.mock("@/lib/marketingAudience", () => ({
  marketingAudience: jest.fn(),
}));

jest.mock("@/lib/marketingLedger", () => ({
  ...jest.requireActual("@/lib/marketingLedger"),
  sentWithin: jest.fn(),
  recordSend: jest.fn(),
}));

const mockNotifySlack = jest.fn();
jest.mock("@fitsy/shared", () => ({
  ...jest.requireActual("@fitsy/shared"),
  notifySlack: (...args: unknown[]) => mockNotifySlack(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { marketingAudience } from "@/lib/marketingAudience";
import { MAX_SENDS_PER_RUN, recordSend, sentWithin } from "@/lib/marketingLedger";

const SECRET = "cron-secret";
const ACCOUNT = { email: "alice@example.org", userId: "u1" };
const WAITLIST_ONLY = { email: "web@example.org", waitlistId: "wl1" };

function makeRequest(qs = "", auth: string | null = `Bearer ${SECRET}`): NextRequest {
  const headers: Record<string, string> = {};
  if (auth) headers["authorization"] = auth;
  return new NextRequest(`http://localhost/api/internal/marketing/weekly${qs}`, { headers });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  process.env["CRON_SECRET"] = SECRET;
  mockNotifySlack.mockResolvedValue(undefined);
  (marketingAudience as jest.Mock).mockResolvedValue([ACCOUNT, WAITLIST_ONLY]);
  (sentWithin as jest.Mock).mockResolvedValue(false);
  (recordSend as jest.Mock).mockResolvedValue(undefined);
  (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env["CRON_SECRET"];
});

describe("GET /api/internal/marketing/weekly", () => {
  it("requires the CRON_SECRET bearer", async () => {
    expect((await GET(makeRequest("", null))).status).toBe(401);
    expect((await GET(makeRequest("", "Bearer nope"))).status).toBe(401);
    expect(marketingAudience).not.toHaveBeenCalled();
  });

  it("asks for accounts only until double opt-in, excluding addresses already sent this week-stamped step", async () => {
    await GET(makeRequest());
    expect(marketingAudience).toHaveBeenCalledWith({
      includeWaitlistOnly: false,
      excludeSent: { campaign: "weekly", step: "ed-1:w35" },
    });
  });

  it("dry run reports the unsent audience without sending", async () => {
    const res = await GET(makeRequest("?dryRun=1"));
    expect(await res.json()).toEqual({ ok: true, dryRun: true, edition: "ed-1", eligible: 2 });
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });

  it("sends with the matching recipient kind and week-stamped key, then records the ledger", async () => {
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual({
      ok: true,
      edition: "ed-1",
      eligible: 2,
      sent: 2,
      paced: 0,
      failed: 0,
      unsent: 0,
    });
    expect(sendMarketingEmail).toHaveBeenNthCalledWith(1, {
      userId: "u1",
      to: "alice@example.org",
      subject: "S",
      html: "<p>h</p>",
      idempotencyKey: "weekly:ed-1:w35:alice@example.org",
    });
    expect(sendMarketingEmail).toHaveBeenNthCalledWith(2, {
      waitlistId: "wl1",
      to: "web@example.org",
      subject: "S",
      html: "<p>h</p>",
      idempotencyKey: "weekly:ed-1:w35:web@example.org",
    });
    // Step is cycle-aware so the edition can recur next rotation.
    expect(recordSend).toHaveBeenCalledWith("alice@example.org", "weekly", "ed-1:w35");
    expect(recordSend).toHaveBeenCalledWith("web@example.org", "weekly", "ed-1:w35");
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("paces an address that heard from any campaign within the frequency cap, without recording", async () => {
    (sentWithin as jest.Mock).mockImplementation(async (email: string) => email === "web@example.org");
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(expect.objectContaining({ sent: 1, paced: 1, unsent: 0 }));
    expect(sendMarketingEmail).not.toHaveBeenCalledWith(expect.objectContaining({ to: "web@example.org" }));
    expect(recordSend).not.toHaveBeenCalledWith("web@example.org", "weekly", "ed-1:w35");
  });

  it("stops at the hard send ceiling, reports the rest as unsent, and tells Slack", async () => {
    expect(MAX_SENDS_PER_RUN).toBe(500);
    const many = Array.from({ length: MAX_SENDS_PER_RUN + 3 }, (_, i) => ({
      email: `u${i}@example.org`,
      userId: `u${i}`,
    }));
    (marketingAudience as jest.Mock).mockResolvedValue(many);
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(
      expect.objectContaining({ eligible: MAX_SENDS_PER_RUN + 3, sent: MAX_SENDS_PER_RUN, unsent: 3 }),
    );
    expect(mockNotifySlack).toHaveBeenCalledWith(
      "weekly editorial incomplete",
      expect.stringContaining("3 not reached"),
      { source: "marketing-weekly" },
    );
  });

  it("stops at the wall-time budget and reports what it did not reach", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-08T16:00:00Z"));
    const many = Array.from({ length: 5 }, (_, i) => ({ email: `u${i}@example.org`, userId: `u${i}` }));
    (marketingAudience as jest.Mock).mockResolvedValue(many);
    // Each send "takes" 100s: after three the 240s budget is spent.
    (sendMarketingEmail as jest.Mock).mockImplementation(async () => {
      jest.advanceTimersByTime(100_000);
      return true;
    });
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(expect.objectContaining({ sent: 3, unsent: 2 }));
    expect(mockNotifySlack).toHaveBeenCalledWith(
      "weekly editorial incomplete",
      expect.stringContaining("2 not reached"),
      { source: "marketing-weekly" },
    );
  });

  it("does not record a failed send, so a re-run picks it up", async () => {
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(expect.objectContaining({ sent: 0, failed: 2, unsent: 0 }));
    expect(recordSend).not.toHaveBeenCalled();
  });
});
