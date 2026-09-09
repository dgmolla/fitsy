jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

import {
  isEmailOptedOut,
  isUndeliverableAddress,
  optedOutAddresses,
  sendMarketingEmail,
} from "@/lib/marketingEmail";
import { makeUnsubscribeToken } from "@/lib/unsubscribe";
import { prisma } from "@/lib/restaurantService";

describe("isUndeliverableAddress", () => {
  it("rejects the reserved TLDs seeded test accounts use", () => {
    // The prod DB carries 200+ seeded accounts on these domains; mailing them
    // hard-bounces and degrades sending reputation for real users.
    expect(isUndeliverableAddress("seed-1@fitsy.test")).toBe(true);
    expect(isUndeliverableAddress("seed-2@fitsy-test.invalid")).toBe(true);
    expect(isUndeliverableAddress("seed-3@fitsy.local")).toBe(true);
    expect(isUndeliverableAddress("seed-4@foo.example")).toBe(true);
    expect(isUndeliverableAddress("seed-5@bar.localhost")).toBe(true);
  });

  it("is case-insensitive on the domain", () => {
    expect(isUndeliverableAddress("Seed@Fitsy.TEST")).toBe(true);
  });

  it("rejects malformed or missing addresses", () => {
    expect(isUndeliverableAddress("no-at-sign")).toBe(true);
    expect(isUndeliverableAddress("")).toBe(true);
    expect(isUndeliverableAddress(null)).toBe(true);
    expect(isUndeliverableAddress(undefined)).toBe(true);
  });

  it("accepts real addresses, including Apple private relay", () => {
    expect(isUndeliverableAddress("dgmolla@gmail.com")).toBe(false);
    expect(isUndeliverableAddress("someone@fitsy.org")).toBe(false);
    expect(isUndeliverableAddress("abc123@privaterelay.appleid.com")).toBe(false);
  });
});

describe("sendMarketingEmail", () => {
  const ENV = {
    RESEND_API_KEY: "re_test",
    UNSUBSCRIBE_SECRET: "secret",
    FITSY_POSTAL_ADDRESS: "1 Main St, Los Angeles, CA",
  } as const;
  const fetchMock = jest.fn();
  const base = { to: "someone@fitsy.org", subject: "Hi", html: "<p>hi</p>" };

  function sentBody(): { html: string; headers: Record<string, string> } {
    const init = fetchMock.mock.calls[0]![1] as { body: string };
    return JSON.parse(init.body);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, ENV);
    global.fetch = fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers() });
    // No opt-out on either table for this address.
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it("fails closed when a compliance env var is missing", async () => {
    delete process.env["FITSY_POSTAL_ADDRESS"];
    expect(await sendMarketingEmail({ userId: "u1", ...base })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("account recipient: mints a u= unsubscribe link", async () => {
    expect(await sendMarketingEmail({ userId: "u1", ...base })).toBe(true);
    const { html, headers } = sentBody();
    const t = makeUnsubscribeToken({ userId: "u1" }) as string;
    expect(html).toContain(`https://fitsy.org/unsubscribe?u=u1&t=${t}`);
    expect(html).toContain("have a Fitsy account and joined our launch list");
    expect(headers["List-Unsubscribe"]).toBe(`<https://fitsy.org/unsubscribe?u=u1&t=${t}>`);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("suppresses by address for BOTH recipient kinds when any record opted out", async () => {
    // Whether the opt-out lives on the User or the LaunchWaitlist row, and
    // whichever record we are sending on behalf of, the address wins.
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ n: 1 }]);
    expect(await sendMarketingEmail({ userId: "u1", ...base })).toBe(false);
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks the address up normalized, on both tables", async () => {
    await sendMarketingEmail({ waitlistId: "wl1", to: "  Someone@Fitsy.ORG ", subject: "s", html: "h" });
    const sql = (prisma.$queryRaw as jest.Mock).mock.calls[0]![0] as {
      strings: string[];
      values: unknown[];
    };
    const text = sql.strings.join("?");
    expect(text).toContain('FROM "User"');
    expect(text).toContain('FROM "LaunchWaitlist"');
    expect(sql.values).toEqual(["someone@fitsy.org", "someone@fitsy.org"]);
  });

  it("waitlist recipient: mints a w= unsubscribe link", async () => {
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(true);
    const { html, headers } = sentBody();
    const t = makeUnsubscribeToken({ waitlistId: "wl1" }) as string;
    expect(html).toContain(`https://fitsy.org/unsubscribe?w=wl1&t=${t}`);
    expect(html).toContain("joined the Fitsy launch list at fitsy.org");
    expect(headers["List-Unsubscribe"]).toBe(`<https://fitsy.org/unsubscribe?w=wl1&t=${t}>`);
  });

  it("isEmailOptedOut reflects the query result", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([]);
    expect(await isEmailOptedOut("a@b.com")).toBe(false);
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ n: 1 }]);
    expect(await isEmailOptedOut("a@b.com")).toBe(true);
  });

  it("returns false when the provider rejects or the request throws", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers() });
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(false);
  });

  it("retries once after a 429, waiting exactly Retry-After seconds, and gives up on a second 429", async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "retry-after": "2" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    const p = sendMarketingEmail({ userId: "u1", ...base });
    // The retry must not fire before the header's 2 seconds have elapsed.
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await p).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers() })
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers() });
    const q = sendMarketingEmail({ userId: "u1", ...base });
    // No header: a 1s default wait, then the second 429 ends it.
    await jest.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(await q).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("sends the caller's idempotency key as a header on every attempt, and none when absent", async () => {
    await sendMarketingEmail({ userId: "u1", ...base, idempotencyKey: "weekly:ed-1:w3:someone@fitsy.org" });
    const headers = (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers["idempotency-key"]).toBe("weekly:ed-1:w3:someone@fitsy.org");
    await sendMarketingEmail({ userId: "u1", ...base });
    const plain = (fetchMock.mock.calls[1]![1] as { headers: Record<string, string> }).headers;
    expect(plain).not.toHaveProperty("idempotency-key");
  });

  it("caps an oversized Retry-After at 5 seconds", async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "retry-after": "3600" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    const p = sendMarketingEmail({ userId: "u1", ...base });
    await jest.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await p).toBe(true);
  });

  it("optedOutAddresses returns the opted-out subset in one query, normalized", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ email: "b@x.org" }]);
    const set = await optedOutAddresses([" A@X.org", "b@x.org", "B@X.ORG"]);
    expect(set).toEqual(new Set(["b@x.org"]));
    const sql = (prisma.$queryRaw as jest.Mock).mock.calls[0]![0] as { values: unknown[] };
    expect(sql.values).toEqual(["a@x.org", "b@x.org", "a@x.org", "b@x.org"]);
    expect(await optedOutAddresses([])).toEqual(new Set());
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
