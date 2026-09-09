import { createHmac } from "node:crypto";
import {
  makeUnsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribe";

const SECRET = "test-unsubscribe-secret";

beforeEach(() => {
  process.env["UNSUBSCRIBE_SECRET"] = SECRET;
});

afterEach(() => {
  delete process.env["UNSUBSCRIBE_SECRET"];
});

describe("makeUnsubscribeToken", () => {
  it("returns null without a secret", () => {
    delete process.env["UNSUBSCRIBE_SECRET"];
    expect(makeUnsubscribeToken({ userId: "user-1" })).toBeNull();
    expect(makeUnsubscribeToken({ waitlistId: "wl-1" })).toBeNull();
  });

  it("hashes the bare userId for accounts, so links minted before waitlist subjects existed still verify", () => {
    const legacy = createHmac("sha256", SECRET).update("user-1").digest("hex");
    expect(makeUnsubscribeToken({ userId: "user-1" })).toBe(legacy);
  });

  it("domain-separates user and waitlist subjects with the same id", () => {
    expect(makeUnsubscribeToken({ userId: "abc" })).not.toBe(
      makeUnsubscribeToken({ waitlistId: "abc" }),
    );
  });
});

describe("verifyUnsubscribeToken", () => {
  it("accepts a token minted for the same subject", () => {
    const t = makeUnsubscribeToken({ waitlistId: "wl-1" }) as string;
    expect(verifyUnsubscribeToken({ waitlistId: "wl-1" }, t)).toBe(true);
  });

  it("rejects a user token presented as a waitlist token, and vice versa", () => {
    const userTok = makeUnsubscribeToken({ userId: "same-id" }) as string;
    const wlTok = makeUnsubscribeToken({ waitlistId: "same-id" }) as string;
    expect(verifyUnsubscribeToken({ waitlistId: "same-id" }, userTok)).toBe(false);
    expect(verifyUnsubscribeToken({ userId: "same-id" }, wlTok)).toBe(false);
  });

  it("rejects wrong-length and empty tokens without throwing", () => {
    expect(verifyUnsubscribeToken({ userId: "user-1" }, "")).toBe(false);
    expect(verifyUnsubscribeToken({ userId: "user-1" }, "abc")).toBe(false);
  });
});

describe("unsubscribeUrl", () => {
  it("builds a u= link for accounts", () => {
    const url = unsubscribeUrl({ userId: "user 1" }) as string;
    expect(url.startsWith("https://fitsy.org/unsubscribe?u=user%201&t=")).toBe(true);
  });

  it("builds a w= link for waitlist-only emails", () => {
    const url = unsubscribeUrl({ waitlistId: "wl-1" }) as string;
    const t = makeUnsubscribeToken({ waitlistId: "wl-1" }) as string;
    expect(url).toBe(`https://fitsy.org/unsubscribe?w=wl-1&t=${t}`);
  });

  it("returns null without a secret", () => {
    delete process.env["UNSUBSCRIBE_SECRET"];
    expect(unsubscribeUrl({ waitlistId: "wl-1" })).toBeNull();
  });
});
