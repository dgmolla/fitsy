import { isUndeliverableAddress } from "@/lib/marketingEmail";

describe("isUndeliverableAddress", () => {
  it("rejects the reserved TLDs seeded test accounts use", () => {
    // The prod DB carries 200+ seeded accounts on these domains; mailing them
    // hard-bounces and degrades sending reputation for real users.
    expect(isUndeliverableAddress("seed-1@fitsy.test")).toBe(true);
    expect(isUndeliverableAddress("seed-2@fitsy-test.invalid")).toBe(true);
    expect(isUndeliverableAddress("seed-3@fitsy.local")).toBe(true);
    expect(isUndeliverableAddress("seed-4@foo.example")).toBe(true);
    expect(isUndeliverableAddress("seed-5@bar.localhost")).toBe(true);
  });

  it("is case-insensitive on the domain", () => {
    expect(isUndeliverableAddress("Seed@Fitsy.TEST")).toBe(true);
  });

  it("rejects malformed or missing addresses", () => {
    expect(isUndeliverableAddress("no-at-sign")).toBe(true);
    expect(isUndeliverableAddress("")).toBe(true);
    expect(isUndeliverableAddress(null)).toBe(true);
    expect(isUndeliverableAddress(undefined)).toBe(true);
  });

  it("accepts real addresses, including Apple private relay", () => {
    expect(isUndeliverableAddress("dgmolla@gmail.com")).toBe(false);
    expect(isUndeliverableAddress("someone@fitsy.org")).toBe(false);
    expect(isUndeliverableAddress("abc123@privaterelay.appleid.com")).toBe(false);
  });
});
