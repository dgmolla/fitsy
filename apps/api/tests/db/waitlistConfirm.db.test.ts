/**
 * Real-database test for the double opt-in claim: the compare-and-set on
 * LaunchWaitlist.confirmSentAt is what stops two concurrent form posts from
 * each delivering a confirmation to a third party's inbox, and the
 * `confirmedAt: null` predicate is what keeps the first confirmation time
 * on a repeat click. Both are proven against real rows, with only the
 * external boundary (the provider HTTP call and Slack) stubbed. Runs when
 * POSTGRES_PRISMA_URL is set.
 */
jest.setTimeout(30_000);

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

const mockNotifySlack = jest.fn();
jest.mock("@fitsy/shared", () => ({
  ...jest.requireActual("@fitsy/shared"),
  notifySlack: (...args: unknown[]) => mockNotifySlack(...args),
}));

describeIfDb("waitlist confirmation claim (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require("@/lib/restaurantService") as typeof import("../../lib/restaurantService");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sender = require("@/lib/waitlistConfirmSend") as typeof import("../../lib/waitlistConfirmSend");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const confirm = require("@/lib/waitlistConfirm") as typeof import("../../lib/waitlistConfirm");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/waitlist/confirm/route") as typeof import("../../app/waitlist/confirm/route");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NextRequest } = require("next/server") as typeof import("next/server");

  const email = `confirm-${Date.now()}@fitsy.org`;
  const realFetch = global.fetch;
  const providerCalls: string[] = [];
  const env = { ...process.env };

  beforeAll(() => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["UNSUBSCRIBE_SECRET"] = "db-test-secret";
    process.env["FITSY_POSTAL_ADDRESS"] = "1 Test St";
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      providerCalls.push(String((init?.headers as Record<string, string>)["idempotency-key"]));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    process.env = env;
    await svc.prisma.marketingSend.deleteMany({ where: { email } });
    await svc.prisma.launchWaitlist.deleteMany({ where: { email } });
    await svc.prisma.$disconnect();
  });

  it("two concurrent sends for one row: exactly one provider call, one claim, one ledger row, no alert", async () => {
    const row = await svc.prisma.launchWaitlist.create({
      data: { email, source: "web", confirmedAt: null, legacyConsent: false },
      select: { id: true, email: true },
    });
    const results = await Promise.all([
      sender.sendWaitlistConfirmation(row),
      sender.sendWaitlistConfirmation(row),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(providerCalls).toHaveLength(1);
    const after = await svc.prisma.launchWaitlist.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.confirmSentAt).not.toBeNull();
    expect(after.confirmedAt).toBeNull();
    expect(await svc.prisma.marketingSend.count({ where: { email, campaign: "lifecycle", step: "confirm" } })).toBe(1);
    expect(mockNotifySlack).not.toHaveBeenCalled();

    // Inside the resend gap the slot is taken: a third submit sends nothing.
    expect(await sender.sendWaitlistConfirmation(row)).toBe(false);
    expect(providerCalls).toHaveLength(1);
  });

  it("a provider failure keeps the 24h slot: the next submit inside the gap sends nothing and nothing is recorded", async () => {
    const failing = await svc.prisma.launchWaitlist.create({
      data: { email: `failing-${email}`, source: "web", confirmedAt: null, legacyConsent: false },
      select: { id: true, email: true },
    });
    const okFetch = global.fetch;
    global.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    try {
      expect(await sender.sendWaitlistConfirmation(failing)).toBe(false);
    } finally {
      global.fetch = okFetch;
    }
    const after = await svc.prisma.launchWaitlist.findUniqueOrThrow({ where: { id: failing.id } });
    expect(after.confirmSentAt).not.toBeNull();
    expect(await svc.prisma.marketingSend.count({ where: { email: failing.email } })).toBe(0);
    expect(await sender.sendWaitlistConfirmation(failing)).toBe(false);
    expect(providerCalls).toHaveLength(1);
    await svc.prisma.launchWaitlist.delete({ where: { id: failing.id } });
  });

  it("a repeat click on the confirmation link keeps the first confirmedAt and still lands on the confirmed page", async () => {
    const row = await svc.prisma.launchWaitlist.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const url = confirm.confirmUrl(row.id) as string;
    const first = await GET(new NextRequest(url));
    expect(first.status).toBe(200);
    const { confirmedAt } = await svc.prisma.launchWaitlist.findUniqueOrThrow({ where: { id: row.id } });
    expect(confirmedAt).not.toBeNull();

    await new Promise((r) => setTimeout(r, 20));
    const second = await GET(new NextRequest(url));
    expect(second.status).toBe(200);
    expect(await second.text()).toContain("confirmed");
    const again = await svc.prisma.launchWaitlist.findUniqueOrThrow({ where: { id: row.id } });
    expect(again.confirmedAt?.getTime()).toBe(confirmedAt?.getTime());

    // Confirmed rows are never sent another confirmation.
    expect(await sender.sendWaitlistConfirmation({ id: row.id, email })).toBe(false);
    expect(providerCalls).toHaveLength(1);
  });
});
