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
  wasSent: jest.fn(),
  countSent: jest.fn(),
  sentWithin: jest.fn(),
  recordSend: jest.fn(),
}));

import { GET, MAX_SENDS_PER_INVOCATION } from "./route";
import { NextRequest } from "next/server";
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { marketingAudience } from "@/lib/marketingAudience";
import { countSent, recordSend, sentWithin, wasSent } from "@/lib/marketingLedger";

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
  process.env["CRON_SECRET"] = SECRET;
  (marketingAudience as jest.Mock).mockResolvedValue([ACCOUNT, WAITLIST_ONLY]);
  (wasSent as jest.Mock).mockResolvedValue(false);
  (countSent as jest.Mock).mockResolvedValue(0);
  (sentWithin as jest.Mock).mockResolvedValue(false);
  (recordSend as jest.Mock).mockResolvedValue(undefined);
  (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  delete process.env["CRON_SECRET"];
});

describe("GET /api/internal/marketing/weekly", () => {
  it("requires the CRON_SECRET bearer", async () => {
    expect((await GET(makeRequest("", null))).status).toBe(401);
    expect((await GET(makeRequest("", "Bearer nope"))).status).toBe(401);
    expect(marketingAudience).not.toHaveBeenCalled();
  });

  it("dry run reports the audience and how many already have this edition, without sending", async () => {
    (countSent as jest.Mock).mockResolvedValue(1);
    const res = await GET(makeRequest("?dryRun=1"));
    expect(countSent).toHaveBeenCalledWith(["alice@example.org", "web@example.org"], "weekly", "ed-1:w35");
    expect(await res.json()).toEqual({
      ok: true,
      dryRun: true,
      edition: "ed-1",
      eligible: 2,
      alreadySent: 1,
    });
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });

  it("sends to accounts and waitlist-only addresses with the matching recipient kind, then records the ledger", async () => {
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual({
      ok: true,
      edition: "ed-1",
      eligible: 2,
      sent: 2,
      skipped: 0,
      paced: 0,
      failed: 0,
    });
    expect(sendMarketingEmail).toHaveBeenNthCalledWith(1, {
      userId: "u1",
      to: "alice@example.org",
      subject: "S",
      html: "<p>h</p>",
    });
    expect(sendMarketingEmail).toHaveBeenNthCalledWith(2, {
      waitlistId: "wl1",
      to: "web@example.org",
      subject: "S",
      html: "<p>h</p>",
    });
    // Step is cycle-aware so the edition can recur next rotation.
    expect(recordSend).toHaveBeenCalledWith("alice@example.org", "weekly", "ed-1:w35");
    expect(recordSend).toHaveBeenCalledWith("web@example.org", "weekly", "ed-1:w35");
  });

  it("asks for accounts only until double opt-in gates waitlist-only rows", async () => {
    await GET(makeRequest());
    expect(marketingAudience).toHaveBeenCalledWith({ includeWaitlistOnly: false });
  });

  it("skips an address that already has this edition, reading the same week-stamped key it writes", async () => {
    (wasSent as jest.Mock).mockImplementation(async (email: string) => email === "alice@example.org");
    const res = await GET(makeRequest());
    expect(wasSent).toHaveBeenCalledWith("alice@example.org", "weekly", "ed-1:w35");
    expect(await res.json()).toEqual(expect.objectContaining({ sent: 1, skipped: 1 }));
    expect(sendMarketingEmail).toHaveBeenCalledTimes(1);
    expect(sendMarketingEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "web@example.org" }));
  });

  it("paces an address that heard from any campaign within the frequency cap, without recording", async () => {
    (sentWithin as jest.Mock).mockImplementation(async (email: string) => email === "web@example.org");
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(expect.objectContaining({ sent: 1, paced: 1 }));
    expect(sendMarketingEmail).not.toHaveBeenCalledWith(expect.objectContaining({ to: "web@example.org" }));
    expect(recordSend).not.toHaveBeenCalledWith("web@example.org", "weekly", "ed-1:w35");
  });

  it("sends at most MAX_SENDS_PER_INVOCATION per run; skipped rows do not consume the cap", async () => {
    const many = Array.from({ length: MAX_SENDS_PER_INVOCATION + 3 }, (_, i) => ({
      email: `u${i}@example.org`,
      userId: `u${i}`,
    }));
    (marketingAudience as jest.Mock).mockResolvedValue(many);
    let res = await GET(makeRequest());
    expect(await res.json()).toEqual(expect.objectContaining({ sent: MAX_SENDS_PER_INVOCATION }));

    jest.clearAllMocks();
    (marketingAudience as jest.Mock).mockResolvedValue(many);
    (sentWithin as jest.Mock).mockResolvedValue(false);
    (recordSend as jest.Mock).mockResolvedValue(undefined);
    (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
    // The first two addresses already have the edition: they are skipped and
    // the cap is still filled from the rest.
    (wasSent as jest.Mock).mockImplementation(async (email: string) => email === "u0@example.org" || email === "u1@example.org");
    res = await GET(makeRequest());
    expect(await res.json()).toEqual(
      expect.objectContaining({ sent: MAX_SENDS_PER_INVOCATION, skipped: 2 }),
    );
  });

  it("does not record a failed send, so it is retried next run", async () => {
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(expect.objectContaining({ sent: 0, failed: 2 }));
    expect(recordSend).not.toHaveBeenCalled();
  });
});
