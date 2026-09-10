jest.mock("@/lib/restaurantService", () => ({
  prisma: { launchWaitlist: { updateMany: jest.fn() } },
}));
jest.mock("@/lib/marketingEmail", () => ({
  sendMarketingEmail: jest.fn(),
  isEmailOptedOut: jest.fn(),
  isUndeliverableAddress: jest.requireActual("@/lib/marketingEmail").isUndeliverableAddress,
}));
jest.mock("@/lib/marketingLedger", () => ({
  recordSend: jest.fn(),
}));
const mockNotifySlack = jest.fn();
jest.mock("@fitsy/shared", () => ({
  ...jest.requireActual("@fitsy/shared"),
  notifySlack: (...args: unknown[]) => mockNotifySlack(...args),
}));

import { CONFIRM_RESEND_GAP_MS, sendWaitlistConfirmation } from "@/lib/waitlistConfirmSend";
import { prisma } from "@/lib/restaurantService";
import { isEmailOptedOut, sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend } from "@/lib/marketingLedger";
import { confirmUrl } from "@/lib/waitlistConfirm";

const ROW = { id: "wl1", email: "web@example.org" };
const NOW = new Date("2026-09-09T12:00:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  process.env["UNSUBSCRIBE_SECRET"] = "secret";
  (prisma.launchWaitlist.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (isEmailOptedOut as jest.Mock).mockResolvedValue(false);
  (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
  (recordSend as jest.Mock).mockResolvedValue(undefined);
  mockNotifySlack.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.useRealTimers();
  delete process.env["UNSUBSCRIBE_SECRET"];
});

describe("sendWaitlistConfirmation", () => {
  it("claims the slot atomically, sends with the signed link and a per-attempt idempotency key, then records", async () => {
    expect(CONFIRM_RESEND_GAP_MS).toBe(24 * 3600e3);
    expect(await sendWaitlistConfirmation(ROW)).toBe(true);
    expect(prisma.launchWaitlist.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wl1",
        confirmedAt: null,
        OR: [{ confirmSentAt: null }, { confirmSentAt: { lt: new Date(NOW.getTime() - CONFIRM_RESEND_GAP_MS) } }],
      },
      data: { confirmSentAt: NOW },
    });
    const arg = (sendMarketingEmail as jest.Mock).mock.calls[0]![0];
    expect(arg.waitlistId).toBe("wl1");
    expect(arg.to).toBe("web@example.org");
    expect(arg.subject).toContain("Confirm");
    expect(arg.html).toContain(confirmUrl("wl1"));
    expect(arg.idempotencyKey).toBe(`lifecycle:confirm:web@example.org:${NOW.toISOString()}`);
    expect(recordSend).toHaveBeenCalledWith("web@example.org", "lifecycle", "confirm");
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("an opted-out address is a permanent refusal: no claim, no send, no alert", async () => {
    (isEmailOptedOut as jest.Mock).mockResolvedValue(true);
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
    expect(sendMarketingEmail).not.toHaveBeenCalled();
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("an undeliverable address is a permanent refusal too", async () => {
    expect(await sendWaitlistConfirmation({ id: "wl2", email: "seed@fitsy.test" })).toBe(false);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
    expect(isEmailOptedOut).not.toHaveBeenCalled();
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("a request that loses the claim (concurrent post, sent within a day, or already confirmed) sends nothing", async () => {
    (prisma.launchWaitlist.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(sendMarketingEmail).not.toHaveBeenCalled();
    expect(recordSend).not.toHaveBeenCalled();
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("a transient provider failure releases the claim (only if still ours), is not recorded, and reaches Slack with the row id", async () => {
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(recordSend).not.toHaveBeenCalled();
    expect(prisma.launchWaitlist.updateMany).toHaveBeenLastCalledWith({
      where: { id: "wl1", confirmSentAt: NOW },
      data: { confirmSentAt: null },
    });
    expect(mockNotifySlack).toHaveBeenCalledWith(
      "waitlist confirmation not sent",
      expect.stringContaining("row wl1"),
      { source: "waitlist-confirm" },
    );
  });

  it("never throws: a thrown send releases the claim and reports false", async () => {
    (sendMarketingEmail as jest.Mock).mockRejectedValue(new Error("boom"));
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(prisma.launchWaitlist.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { confirmSentAt: null } }),
    );
  });

  it("a throw before the claim releases nothing", async () => {
    (isEmailOptedOut as jest.Mock).mockRejectedValue(new Error("db down"));
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
  });

  it("cannot mint a link without the signing secret: claims and sends nothing, but tells Slack the configuration is missing", async () => {
    delete process.env["UNSUBSCRIBE_SECRET"];
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
    expect(sendMarketingEmail).not.toHaveBeenCalled();
    expect(mockNotifySlack).toHaveBeenCalledWith(
      "waitlist confirmation not sent",
      expect.stringMatching(/wl1.*UNSUBSCRIBE_SECRET/),
      { source: "waitlist-confirm" },
    );
  });
});
