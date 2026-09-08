jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    marketingSend: { findUnique: jest.fn(), upsert: jest.fn(), findFirst: jest.fn() },
  },
}));

import { prisma } from "@/lib/restaurantService";
import { MARKETING_MIN_GAP_MS, recordSend, sentWithin, wasSent } from "@/lib/marketingLedger";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("marketingLedger", () => {
  it("wasSent looks the step up by normalized address", async () => {
    (prisma.marketingSend.findUnique as jest.Mock).mockResolvedValue({ id: "x" });
    expect(await wasSent(" Alice@Example.org ", "weekly", "ed-1")).toBe(true);
    expect(prisma.marketingSend.findUnique).toHaveBeenCalledWith({
      where: { email_campaign_step: { email: "alice@example.org", campaign: "weekly", step: "ed-1" } },
      select: { id: true },
    });
    (prisma.marketingSend.findUnique as jest.Mock).mockResolvedValue(null);
    expect(await wasSent("alice@example.org", "weekly", "ed-1")).toBe(false);
  });

  it("recordSend is an idempotent upsert on the unique key", async () => {
    await recordSend("Alice@Example.org", "launch", "Los Angeles");
    expect(prisma.marketingSend.upsert).toHaveBeenCalledWith({
      where: {
        email_campaign_step: { email: "alice@example.org", campaign: "launch", step: "Los Angeles" },
      },
      create: { email: "alice@example.org", campaign: "launch", step: "Los Angeles" },
      update: {},
    });
  });

  it("sentWithin applies the 48h cross-campaign cap by default", async () => {
    const before = Date.now();
    (prisma.marketingSend.findFirst as jest.Mock).mockResolvedValue({ id: "x" });
    expect(await sentWithin("alice@example.org")).toBe(true);
    const arg = (prisma.marketingSend.findFirst as jest.Mock).mock.calls[0]![0];
    expect(arg.where.email).toBe("alice@example.org");
    const since = (arg.where.sentAt.gt as Date).getTime();
    expect(before - since).toBeGreaterThanOrEqual(MARKETING_MIN_GAP_MS - 1000);
    expect(before - since).toBeLessThanOrEqual(MARKETING_MIN_GAP_MS + 1000);
    expect(MARKETING_MIN_GAP_MS).toBe(48 * 3600e3);
  });

  it("sentWithin is false when nothing was sent in the window", async () => {
    (prisma.marketingSend.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await sentWithin("alice@example.org", 1000)).toBe(false);
  });
});
