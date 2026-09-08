jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    launchWaitlist: { findUnique: jest.fn() },
  },
}));

import { isUndeliverableAddress, sendMarketingEmail } from "@/lib/marketingEmail";
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
    global.fetch = fetchMock.mockResolvedValue({ ok: true });
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ emailOptOutAt: null }]);
    (prisma.launchWaitlist.findUnique as jest.Mock).mockResolvedValue({ emailOptOutAt: null });
  });

  afterEach(() => {
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it("fails closed when a compliance env var is missing", async () => {
    delete process.env["FITSY_POSTAL_ADDRESS"];
    expect(await sendMarketingEmail({ userId: "u1", ...base })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("account recipient: checks User opt-out and mints a u= unsubscribe link", async () => {
    expect(await sendMarketingEmail({ userId: "u1", ...base })).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.launchWaitlist.findUnique).not.toHaveBeenCalled();
    const { html, headers } = sentBody();
    const t = makeUnsubscribeToken({ userId: "u1" }) as string;
    expect(html).toContain(`https://fitsy.org/unsubscribe?u=u1&t=${t}`);
    expect(html).toContain("have a Fitsy account and joined our launch list");
    expect(headers["List-Unsubscribe"]).toBe(`<https://fitsy.org/unsubscribe?u=u1&t=${t}>`);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("account recipient: skips opted-out users", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ emailOptOutAt: new Date() }]);
    expect(await sendMarketingEmail({ userId: "u1", ...base })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waitlist recipient: checks the waitlist row and mints a w= unsubscribe link", async () => {
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(true);
    expect(prisma.launchWaitlist.findUnique).toHaveBeenCalledWith({
      where: { id: "wl1" },
      select: { emailOptOutAt: true },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    const { html, headers } = sentBody();
    const t = makeUnsubscribeToken({ waitlistId: "wl1" }) as string;
    expect(html).toContain(`https://fitsy.org/unsubscribe?w=wl1&t=${t}`);
    expect(html).toContain("joined the Fitsy launch list at fitsy.org");
    expect(headers["List-Unsubscribe"]).toBe(`<https://fitsy.org/unsubscribe?w=wl1&t=${t}>`);
  });

  it("waitlist recipient: skips opted-out or missing rows", async () => {
    (prisma.launchWaitlist.findUnique as jest.Mock).mockResolvedValueOnce({
      emailOptOutAt: new Date(),
    });
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(false);
    (prisma.launchWaitlist.findUnique as jest.Mock).mockResolvedValueOnce(null);
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false when the provider rejects or the request throws", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await sendMarketingEmail({ waitlistId: "wl1", ...base })).toBe(false);
  });
});
