import { WEEKLY_EDITIONS, editionForDate, weekIndexForDate } from "@/lib/emailTemplates";

// The rotation epoch: Monday 2026-01-05 00:00:00 UTC. weekIndexForDate is the
// weekly send's ledger key, so its boundaries are load-bearing.
describe("weekIndexForDate", () => {
  it("is 0 at the epoch and -1 one second before it", () => {
    expect(weekIndexForDate(new Date("2026-01-05T00:00:00Z"))).toBe(0);
    expect(weekIndexForDate(new Date("2026-01-04T23:59:59Z"))).toBe(-1);
  });

  it("stays 0 through the last second of week 0 and turns 1 at the next Monday", () => {
    expect(weekIndexForDate(new Date("2026-01-11T23:59:59Z"))).toBe(0);
    expect(weekIndexForDate(new Date("2026-01-12T00:00:00Z"))).toBe(1);
  });

  it("is stable across a week, so a retry within the week reuses the ledger key", () => {
    expect(weekIndexForDate(new Date("2026-09-08T15:50:00Z"))).toBe(
      weekIndexForDate(new Date("2026-09-13T23:00:00Z")),
    );
  });
});

describe("editionForDate", () => {
  it("rotates through all editions in order and wraps after one cycle", () => {
    const n = WEEKLY_EDITIONS.length;
    const week = (i: number) => new Date(Date.UTC(2026, 0, 5) + i * 7 * 86400e3);
    for (let i = 0; i < n; i++) {
      expect(editionForDate(week(i)).slug).toBe(WEEKLY_EDITIONS[i]!.slug);
    }
    expect(editionForDate(week(n)).slug).toBe(WEEKLY_EDITIONS[0]!.slug);
  });

  it("handles dates before the epoch without going out of range", () => {
    expect(WEEKLY_EDITIONS.map((e) => e.slug)).toContain(editionForDate(new Date("2025-12-01T00:00:00Z")).slug);
  });
});
