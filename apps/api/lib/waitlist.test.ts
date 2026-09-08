import { coarseCoord, isValidWaitlistEmail, normalizeEmail } from "@/lib/waitlist";

describe("normalizeEmail", () => {
  it("trims and lowercases so one person is one row", () => {
    expect(normalizeEmail("  Dawit@Gmail.com ")).toBe("dawit@gmail.com");
  });
});

describe("isValidWaitlistEmail", () => {
  it("accepts ordinary and private-relay addresses", () => {
    expect(isValidWaitlistEmail("someone@fitsy.org")).toBe(true);
    expect(isValidWaitlistEmail("abc123@privaterelay.appleid.com")).toBe(true);
    expect(isValidWaitlistEmail("first.last+tag@sub.example-domain.co")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidWaitlistEmail("")).toBe(false);
    expect(isValidWaitlistEmail("no-at-sign")).toBe(false);
    expect(isValidWaitlistEmail("@nodomain.com")).toBe(false);
    expect(isValidWaitlistEmail("nodot@localhost")).toBe(false);
    expect(isValidWaitlistEmail("two@@ats.com")).toBe(false);
    expect(isValidWaitlistEmail("has space@x.com")).toBe(false);
  });

  it("rejects reserved TLDs that would hard-bounce", () => {
    expect(isValidWaitlistEmail("seed-1@fitsy.test")).toBe(false);
    expect(isValidWaitlistEmail("a@b.invalid")).toBe(false);
  });

  it("rejects addresses over the RFC 5321 length limit", () => {
    const local = "a".repeat(250);
    expect(isValidWaitlistEmail(`${local}@x.com`)).toBe(false);
  });
});

describe("coarseCoord", () => {
  it("rounds to one decimal (~city precision)", () => {
    expect(coarseCoord(34.0522)).toBe(34.1);
    expect(coarseCoord(-118.2437)).toBe(-118.2);
  });
});
