jest.mock("@/lib/marketingEmail", () => ({
  sendMarketingEmail: jest.fn(),
}));
jest.mock("@/lib/marketingLedger", () => ({
  recordSend: jest.fn(),
  sentWithin: jest.fn(),
}));

import { sendWaitlistConfirmation } from "@/lib/waitlistConfirmSend";
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend, sentWithin } from "@/lib/marketingLedger";
import { confirmUrl } from "@/lib/waitlistConfirm";

const ROW = { id: "wl1", email: "web@example.org" };

beforeEach(() => {
  jest.clearAllMocks();
  process.env["UNSUBSCRIBE_SECRET"] = "secret";
  (sentWithin as jest.Mock).mockResolvedValue(false);
  (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
  (recordSend as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => {
  delete process.env["UNSUBSCRIBE_SECRET"];
});

describe("sendWaitlistConfirmation", () => {
  it("sends the confirmation as a waitlist recipient with the signed link, then records it", async () => {
    expect(await sendWaitlistConfirmation(ROW)).toBe(true);
    const arg = (sendMarketingEmail as jest.Mock).mock.calls[0]![0];
    expect(arg.waitlistId).toBe("wl1");
    expect(arg.to).toBe("web@example.org");
    expect(arg.subject).toContain("Confirm");
    expect(arg.html).toContain(confirmUrl("wl1"));
    expect(sentWithin).toHaveBeenCalledWith("web@example.org", 24 * 3600e3);
    expect(recordSend).toHaveBeenCalledWith("web@example.org", "lifecycle", "confirm");
  });

  it("throttles to one confirmation per address per day", async () => {
    (sentWithin as jest.Mock).mockResolvedValue(true);
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });

  it("does not record a failed send, and never throws", async () => {
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(recordSend).not.toHaveBeenCalled();
    (sendMarketingEmail as jest.Mock).mockRejectedValue(new Error("boom"));
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
  });

  it("cannot mint a link without the signing secret, so it sends nothing", async () => {
    delete process.env["UNSUBSCRIBE_SECRET"];
    expect(await sendWaitlistConfirmation(ROW)).toBe(false);
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });
});
