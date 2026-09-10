jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

import { prisma } from "@/lib/restaurantService";
import { marketingAudience } from "@/lib/marketingAudience";

// Fast smoke checks on the query shapes and the merge; the executable proof
// of the opt-out SQL is tests/db/marketingAudience.db.test.ts.
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(async (sql: string) =>
    // The waitlist query also mentions "User" in its NOT EXISTS, so key on
    // the branch-specific predicate instead.
    !sql.includes('w."userId" IS NULL')
      ? [
          { id: "u1", email: "alice@example.org" },
          { id: "u2", email: "seed@fitsy.test" },
          { id: "u3", email: "both@example.org" },
        ]
      : [
          { id: "wl1", email: "web@example.org" },
          { id: "wl2", email: "both@example.org" }, // same address as u3, should collapse
          { id: "wl3", email: "bot@spam.invalid" },
        ],
  );
});

describe("marketingAudience", () => {
  it("with includeWaitlistOnly: unions accounts and waitlist-only rows, one recipient per address, no undeliverable seeds", async () => {
    const audience = await marketingAudience({ includeWaitlistOnly: true });
    expect(audience).toEqual([
      { email: "alice@example.org", userId: "u1" },
      { email: "both@example.org", userId: "u3" },
      { email: "web@example.org", waitlistId: "wl1" },
    ]);
  });

  it("leaves waitlist-only rows out unless asked", async () => {
    const audience = await marketingAudience({ includeWaitlistOnly: false });
    expect(audience.map((r) => r.email)).toEqual(["alice@example.org", "both@example.org"]);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("each branch mirrors the other table's opt-out for the same address", async () => {
    await marketingAudience({ includeWaitlistOnly: true });
    const [userSql, waitlistSql] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(userSql).toContain('u."emailOptOutAt" IS NULL');
    expect(userSql).toContain('w."email" = lower(u."email") AND w."emailOptOutAt" IS NOT NULL');
    expect(waitlistSql).toContain('w."userId" IS NULL');
    expect(waitlistSql).toContain('w."emailOptOutAt" IS NULL');
    expect(waitlistSql).toContain('w."confirmedAt" IS NOT NULL');
    expect(waitlistSql).toContain('lower(u."email") = w."email" AND u."emailOptOutAt" IS NOT NULL');
  });

  it("excludes addresses the ledger already records for a step, in both branches, with bound params", async () => {
    await marketingAudience({ includeWaitlistOnly: true, excludeSent: { campaign: "weekly", step: "ed-1:w35" } });
    const calls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls;
    for (const c of calls) {
      const sql = c[0] as string;
      expect(sql).toContain('FROM "MarketingSend" m');
      expect(sql).toContain('m."campaign" = $1 AND m."step" = $2');
      expect(c.slice(1)).toEqual(["weekly", "ed-1:w35"]);
    }
    expect(calls[0]![0]).toContain('m."email" = lower(u."email")');
    expect(calls[1]![0]).toContain('m."email" = w."email"');
  });

  it("does not mention the ledger when no exclusion is requested", async () => {
    await marketingAudience({ includeWaitlistOnly: true });
    for (const c of (prisma.$queryRawUnsafe as jest.Mock).mock.calls) {
      expect(c[0] as string).not.toContain("MarketingSend");
      expect(c.slice(1)).toEqual([]);
    }
  });

  it("orders both branches deterministically so capped runs walk past the sent prefix", async () => {
    await marketingAudience({ includeWaitlistOnly: true });
    const [userSql, waitlistSql] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(userSql).toMatch(/ORDER BY u\."createdAt" ASC, u\.id ASC\s*$/);
    expect(waitlistSql).toMatch(/ORDER BY w\."createdAt" ASC, w\.id ASC\s*$/);
  });
});
