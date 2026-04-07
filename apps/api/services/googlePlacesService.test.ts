import { normalizePriceLevel, PRICE_LEVEL_MAP } from "./googlePlacesService";

describe("normalizePriceLevel", () => {
  it("maps all known Google Places enum values to symbols", () => {
    expect(normalizePriceLevel("PRICE_LEVEL_FREE")).toBe("$");
    expect(normalizePriceLevel("PRICE_LEVEL_INEXPENSIVE")).toBe("$");
    expect(normalizePriceLevel("PRICE_LEVEL_MODERATE")).toBe("$$");
    expect(normalizePriceLevel("PRICE_LEVEL_EXPENSIVE")).toBe("$$$");
    expect(normalizePriceLevel("PRICE_LEVEL_VERY_EXPENSIVE")).toBe("$$$$");
  });

  it("returns null for undefined input", () => {
    expect(normalizePriceLevel(undefined)).toBeNull();
  });

  it("returns null for unknown enum string", () => {
    expect(normalizePriceLevel("PRICE_LEVEL_UNKNOWN")).toBeNull();
    expect(normalizePriceLevel("")).toBeNull();
    expect(normalizePriceLevel("$$")).toBeNull();
  });

  it("PRICE_LEVEL_MAP covers all 5 known levels", () => {
    expect(Object.keys(PRICE_LEVEL_MAP)).toHaveLength(5);
  });
});
