/**
 * Real-database test for the marketing audience (tenet T5: the opt-out
 * filter is SQL, so only real rows prove it). Runs when POSTGRES_PRISMA_URL
 * is set (CI container, or the dev DB locally); skipped otherwise.
 *
 * Seeds its own rows under a unique tag and removes them afterwards, so it
 * is safe against a shared dev database.
 */
jest.setTimeout(30_000);

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("marketingAudience (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require("@/lib/restaurantService") as typeof import("../../lib/restaurantService");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const aud = require("@/lib/marketingAudience") as typeof import("../../lib/marketingAudience");
  const prisma = svc.prisma;

  const tag = `aud-${Date.now()}`;
  const email = (name: string) => `${tag}-${name}@fitsy.org`;
  const userIds: string[] = [];

  async function user(name: string, opts: { emailOptOutAt?: Date; emailCase?: (e: string) => string } = {}) {
    const id = `${tag}-${name}`;
    userIds.push(id);
    await prisma.user.create({
      data: {
        id,
        email: opts.emailCase ? opts.emailCase(email(name)) : email(name),
        ...(opts.emailOptOutAt ? { emailOptOutAt: opts.emailOptOutAt } : {}),
      },
    });
    return id;
  }

  beforeAll(async () => {
    await user("plain");
    await user("optedout", { emailOptOutAt: new Date() });
    await user("rowoptout");
    await user("mixed", { emailCase: (e) => e.toUpperCase() });
    await user("acctoptout", { emailOptOutAt: new Date() });
    await prisma.launchWaitlist.createMany({
      data: [
        // opted out on the waitlist row only: the account must be excluded
        { email: email("rowoptout"), source: "web", emailOptOutAt: new Date() },
        // lowercase row for the mixed-case account: one recipient, the account
        { email: email("mixed"), source: "web" },
        // waitlist-only, eligible
        { email: email("webonly"), source: "web" },
        // waitlist-only, opted out
        { email: email("weboptout"), source: "web", emailOptOutAt: new Date() },
        // unlinked row whose ACCOUNT opted out: the reverse direction
        { email: email("acctoptout"), source: "web" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.launchWaitlist.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("optedOutAddresses returns exactly the opted-out subset across both tables, case-insensitively", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const me = require("@/lib/marketingEmail") as typeof import("../../lib/marketingEmail");
    const set = await me.optedOutAddresses([
      email("plain"),
      email("optedout").toUpperCase(), // User opt-out, mixed-case input
      email("rowoptout"), // waitlist-row opt-out
      email("weboptout"),
      email("acctoptout"),
      email("mixed"),
      "nobody-" + email("x"),
    ]);
    expect([...set].sort()).toEqual(
      [email("optedout"), email("rowoptout"), email("weboptout"), email("acctoptout")].sort(),
    );
  });

  it("includes eligible accounts and waitlist-only rows once each, excludes every opt-out", async () => {
    const rows = (await aud.marketingAudience({ includeWaitlistOnly: true })).filter((r) => r.email.startsWith(tag));
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));
    expect(Object.keys(byEmail).sort()).toEqual([email("mixed"), email("plain"), email("webonly")].sort());
    expect(byEmail[email("plain")]).toEqual({ email: email("plain"), userId: `${tag}-plain` });
    // the mixed-case account wins over its lowercase waitlist row, lowercased
    expect(byEmail[email("mixed")]).toEqual({ email: email("mixed"), userId: `${tag}-mixed` });
    expect(byEmail[email("webonly")]!.waitlistId).toBeDefined();
  });
});
