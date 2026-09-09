/**
 * Real-database test for the MarketingSend ledger: the unique key and the
 * time-window query are what make campaigns idempotent and paced, so they
 * are proven against real rows. Runs when POSTGRES_PRISMA_URL is set.
 */
jest.setTimeout(30_000);

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("marketingLedger (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require("@/lib/restaurantService") as typeof import("../../lib/restaurantService");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ledger = require("@/lib/marketingLedger") as typeof import("../../lib/marketingLedger");
  const email = `ledger-${Date.now()}@fitsy.org`;

  afterAll(async () => {
    await svc.prisma.marketingSend.deleteMany({ where: { email } });
    await svc.prisma.$disconnect();
  });

  it("records a step once, reports it sent, and paces within the window only", async () => {
    expect(await ledger.wasSent(email, "weekly", "ed-x:w1")).toBe(false);
    await ledger.recordSend(email.toUpperCase(), "weekly", "ed-x:w1");
    await ledger.recordSend(email, "weekly", "ed-x:w1");
    expect(await svc.prisma.marketingSend.count({ where: { email } })).toBe(1);
    expect(await ledger.wasSent(email, "weekly", "ed-x:w1")).toBe(true);
    expect(await ledger.countSent([email, "nobody@fitsy.org"], "weekly", "ed-x:w1")).toBe(1);
    expect(await ledger.sentWithin(email)).toBe(true);
    expect(await ledger.sentWithin(email, 1)).toBe(false);
  });
});
