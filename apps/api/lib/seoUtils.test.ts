import {
  slugify,
  slugWithId,
  parseSlugId,
  calcCalories,
  confidenceLabel,
  priceSymbol,
  formatTag,
} from "./seoUtils";

describe("slugify", () => {
  it("lowercases, trims, and replaces non-alphanumerics with dashes", () => {
    expect(slugify("  Chipotle Mexican Grill!  ")).toBe("chipotle-mexican-grill");
  });
  it("collapses runs of separators into a single dash", () => {
    expect(slugify("A   B__C")).toBe("a-b-c");
  });
  it("strips leading and trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello");
  });
  it("returns empty string for input with no alphanumerics", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("calcCalories", () => {
  it("computes 4/4/9 calorie totals and rounds", () => {
    expect(calcCalories(20, 30, 10)).toBe(20 * 4 + 30 * 4 + 10 * 9);
  });
  it("rounds fractional results", () => {
    expect(calcCalories(0.4, 0.4, 0.4)).toBe(Math.round(0.4 * 4 + 0.4 * 4 + 0.4 * 9));
  });
});

describe("confidenceLabel", () => {
  it("maps HIGH to High confidence", () => {
    expect(confidenceLabel("HIGH")).toBe("High confidence");
  });
  it("maps MEDIUM to Estimated", () => {
    expect(confidenceLabel("MEDIUM")).toBe("Estimated");
  });
  it("falls back to Approximate for unknown levels", () => {
    expect(confidenceLabel("LOW")).toBe("Approximate");
    expect(confidenceLabel("anything-else")).toBe("Approximate");
  });
});

describe("priceSymbol", () => {
  it.each([
    ["PRICE_LEVEL_INEXPENSIVE", "$"],
    ["PRICE_LEVEL_MODERATE", "$$"],
    ["PRICE_LEVEL_EXPENSIVE", "$$$"],
    ["PRICE_LEVEL_VERY_EXPENSIVE", "$$$$"],
  ])("maps %s to %s", (input, expected) => {
    expect(priceSymbol(input)).toBe(expected);
  });
  it("returns empty string for unknown, null, or undefined", () => {
    expect(priceSymbol(null)).toBe("");
    expect(priceSymbol(undefined)).toBe("");
    expect(priceSymbol("PRICE_LEVEL_UNSPECIFIED")).toBe("");
  });
});

describe("slugWithId", () => {
  it("joins slugified name and id with `--`", () => {
    expect(slugWithId("Sushi Park", "abc-123")).toBe("sushi-park--abc-123");
  });
  it("works with UUID ids that contain dashes", () => {
    expect(slugWithId("Joe's Diner", "4b18fb32-6118-4e42-9967-54baf75fc39c")).toBe(
      "joe-s-diner--4b18fb32-6118-4e42-9967-54baf75fc39c",
    );
  });
});

describe("parseSlugId", () => {
  it("splits on the last `--` so UUID dashes in the id stay intact", () => {
    expect(parseSlugId("joe-s-diner--4b18fb32-6118-4e42-9967-54baf75fc39c")).toEqual({
      slug: "joe-s-diner",
      id: "4b18fb32-6118-4e42-9967-54baf75fc39c",
    });
  });
  it("returns null when separator is missing", () => {
    expect(parseSlugId("just-a-slug")).toBeNull();
  });
  it("returns null when slug or id is empty", () => {
    expect(parseSlugId("--abc")).toBeNull();
    expect(parseSlugId("abc--")).toBeNull();
  });
  it("round-trips with slugWithId", () => {
    const built = slugWithId("Spicy Tuna Roll", "abc-def-123");
    expect(parseSlugId(built)).toEqual({ slug: "spicy-tuna-roll", id: "abc-def-123" });
  });
});

describe("formatTag", () => {
  it("title-cases underscore-separated tokens", () => {
    expect(formatTag("HIGH_PROTEIN")).toBe("High Protein");
  });
  it("handles a single token", () => {
    expect(formatTag("vegan")).toBe("Vegan");
  });
  it("normalizes mixed-case input", () => {
    expect(formatTag("LoW_cArB")).toBe("Low Carb");
  });
});
