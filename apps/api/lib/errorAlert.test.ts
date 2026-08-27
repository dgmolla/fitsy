import { shouldAlert, resetAlertDedup } from "@/lib/errorAlert";

describe("shouldAlert dedup", () => {
  beforeEach(() => resetAlertDedup());

  it("allows the first alert for a key", () => {
    expect(shouldAlert("GET /api/restaurants", 1_000)).toBe(true);
  });

  it("suppresses repeats inside the 15-minute window", () => {
    expect(shouldAlert("k", 0)).toBe(true);
    expect(shouldAlert("k", 60_000)).toBe(false);
    expect(shouldAlert("k", 14 * 60_000)).toBe(false);
  });

  it("allows again after the window elapses", () => {
    expect(shouldAlert("k", 0)).toBe(true);
    expect(shouldAlert("k", 15 * 60_000 + 1)).toBe(true);
  });

  it("tracks keys independently", () => {
    expect(shouldAlert("a", 0)).toBe(true);
    expect(shouldAlert("b", 1)).toBe(true);
    expect(shouldAlert("a", 2)).toBe(false);
  });
});
