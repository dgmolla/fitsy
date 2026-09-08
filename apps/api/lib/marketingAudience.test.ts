jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
    launchWaitlist: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/restaurantService";
import { marketingAudience } from "@/lib/marketingAudience";

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
    { id: "u1", email: "alice@example.org" },
    { id: "u2", email: "seed@fitsy.test" },
    { id: "u3", email: "both@example.org" },
  ]);
  (prisma.launchWaitlist.findMany as jest.Mock).mockResolvedValue([
    { id: "wl1", email: "web@example.org" },
    { id: "wl2", email: "both@example.org" }, // same address as u3, should collapse
    { id: "wl3", email: "bot@spam.invalid" },
  ]);
});

describe("marketingAudience", () => {
  it("unions accounts and waitlist-only rows, one recipient per address, no undeliverable seeds", async () => {
    const audience = await marketingAudience();
    expect(audience).toEqual([
      { email: "alice@example.org", userId: "u1" },
      { email: "both@example.org", userId: "u3" },
      { email: "web@example.org", waitlistId: "wl1" },
    ]);
  });

  it("account query honours a waitlist-row opt-out for the same address", async () => {
    await marketingAudience();
    const sql = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0]![0] as string;
    expect(sql).toContain('u."emailOptOutAt" IS NULL');
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain('w."email" = lower(u."email")');
    expect(sql).toContain('w."emailOptOutAt" IS NOT NULL');
  });

  it("waitlist query takes only unlinked rows that have not opted out", async () => {
    await marketingAudience();
    expect(prisma.launchWaitlist.findMany).toHaveBeenCalledWith({
      where: { userId: null, emailOptOutAt: null },
      select: { id: true, email: true },
    });
  });
});
