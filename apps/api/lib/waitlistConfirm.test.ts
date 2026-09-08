import { confirmUrl, makeConfirmToken, verifyConfirmToken } from "@/lib/waitlistConfirm";
import { makeUnsubscribeToken } from "@/lib/unsubscribe";

beforeEach(() => {
  process.env["UNSUBSCRIBE_SECRET"] = "secret";
});
afterEach(() => {
  delete process.env["UNSUBSCRIBE_SECRET"];
});

describe("waitlistConfirm tokens", () => {
  it("returns null without the signing secret", () => {
    delete process.env["UNSUBSCRIBE_SECRET"];
    expect(makeConfirmToken("wl1")).toBeNull();
    expect(confirmUrl("wl1")).toBeNull();
    expect(verifyConfirmToken("wl1", "abc")).toBe(false);
  });

  it("round-trips and rejects tampering", () => {
    const t = makeConfirmToken("wl1") as string;
    expect(verifyConfirmToken("wl1", t)).toBe(true);
    expect(verifyConfirmToken("wl2", t)).toBe(false);
    expect(verifyConfirmToken("wl1", t.slice(0, -1) + "0")).toBe(false);
    expect(verifyConfirmToken("wl1", "")).toBe(false);
  });

  it("never validates an unsubscribe token for the same row (domain separation)", () => {
    const unsub = makeUnsubscribeToken({ waitlistId: "wl1" }) as string;
    expect(verifyConfirmToken("wl1", unsub)).toBe(false);
  });

  it("builds the signed confirm URL", () => {
    const t = makeConfirmToken("wl 1") as string;
    expect(confirmUrl("wl 1")).toBe(`https://fitsy.org/waitlist/confirm?w=wl%201&t=${t}`);
  });
});
