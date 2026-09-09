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

  it("the migration's legacy backfill block produces the week-stamped key the cron reads", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tpl = require("@/lib/emailTemplates") as typeof import("../../lib/emailTemplates");
    const sql = fs.readFileSync(
      path.join(__dirname, "../../../../prisma/migrations/20260908100000_marketing_send_ledger/migration.sql"),
      "utf8",
    );
    const doBlock = sql.slice(sql.indexOf("DO $$"), sql.indexOf("END $$;") + "END $$;".length);
    const legacyEmail = `legacy-${Date.now()}@fitsy.org`;
    const userId = `legacy-${Date.now()}`;
    const sentAt = new Date("2026-03-03T16:00:00Z");
    // Everything happens inside one transaction that is rolled back at the
    // end, so the legacy table, the seeded user, and every row the migration
    // block copies leave no trace in the shared database.
    const ROLLBACK = new Error("rollback");
    let observed: [string, string][] = [];
    await svc.prisma
      .$transaction(async (tx) => {
        await tx.user.create({ data: { id: userId, email: legacyEmail.toUpperCase() } });
        await tx.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "_marketing_send" (edition text NOT NULL, user_id text NOT NULL, sent_at timestamptz DEFAULT now(), PRIMARY KEY (edition, user_id))`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "_marketing_send" (edition, user_id, sent_at) VALUES ($1, $2, $3)`,
          "sauce-math",
          userId,
          sentAt,
        );
        await tx.$executeRawUnsafe(doBlock);
        const rows = await tx.marketingSend.findMany({ where: { email: legacyEmail } });
        observed = rows.map((r) => [r.campaign, r.step]);
        throw ROLLBACK;
      })
      .catch((e: unknown) => {
        if (e !== ROLLBACK) throw e;
      });
    expect(observed).toEqual([["weekly", `sauce-math:w${tpl.weekIndexForDate(sentAt)}`]]);
    // Rolled back: nothing left behind.
    expect(await svc.prisma.marketingSend.count({ where: { email: legacyEmail } })).toBe(0);
    expect(await svc.prisma.user.count({ where: { id: userId } })).toBe(0);
  });

  it("the migration's week-stamp SQL agrees with weekIndexForDate at the boundaries", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tpl = require("@/lib/emailTemplates") as typeof import("../../lib/emailTemplates");
    const stamps = [
      "2026-01-04T23:59:59Z",
      "2026-01-05T00:00:00Z",
      "2026-01-11T23:59:59Z",
      "2026-01-12T00:00:00Z",
      "2026-09-08T16:00:00Z",
    ];
    for (const ts of stamps) {
      const rows = await svc.prisma.$queryRawUnsafe<{ w: number }[]>(
        `SELECT floor((extract(epoch FROM $1::timestamptz) - extract(epoch FROM timestamptz '2026-01-05 00:00:00+00')) / 604800)::int AS w`,
        ts,
      );
      expect(rows[0]!.w).toBe(tpl.weekIndexForDate(new Date(ts)));
    }
  });

  it("records a step once, reports it sent, and paces within the window only", async () => {
    expect(await ledger.wasSent(email, "weekly", "ed-x:w1")).toBe(false);
    await ledger.recordSend(email.toUpperCase(), "weekly", "ed-x:w1");
    await ledger.recordSend(email, "weekly", "ed-x:w1");
    expect(await svc.prisma.marketingSend.count({ where: { email } })).toBe(1);
    expect(await ledger.wasSent(email, "weekly", "ed-x:w1")).toBe(true);
    expect(await ledger.sentWithin(email)).toBe(true);
    expect(await ledger.sentWithin(email, 1)).toBe(false);
  });
});
