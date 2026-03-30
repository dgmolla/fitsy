import { calculateAge } from "@fitsy/shared";

describe("calculateAge", () => {
  it("computes age from an ISO date string", () => {
    const age = calculateAge("2000-01-01");
    const expected = new Date().getFullYear() - 2000 - (new Date() < new Date(new Date().getFullYear(), 0, 1) ? 1 : 0);
    expect(age).toBe(expected);
  });

  it("computes age from a Date object", () => {
    const age = calculateAge(new Date("1990-06-15"));
    expect(age).toBeGreaterThanOrEqual(35);
    expect(age).toBeLessThanOrEqual(36);
  });

  it("has not yet had birthday this year (birthday is tomorrow)", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setFullYear(tomorrow.getFullYear() - 20);
    const age = calculateAge(tomorrow);
    expect(age).toBe(19);
  });

  it("has birthday today", () => {
    const today = new Date();
    today.setFullYear(today.getFullYear() - 20);
    const iso = today.toISOString().split("T")[0]!;
    const age = calculateAge(iso);
    expect(age).toBe(20);
  });

  it("had birthday yesterday", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setFullYear(yesterday.getFullYear() - 20);
    const iso = yesterday.toISOString().split("T")[0]!;
    const age = calculateAge(iso);
    expect(age).toBe(20);
  });
});
