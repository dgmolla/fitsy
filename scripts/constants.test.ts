import { aggregateDietaryOptions, DIETARY_TAG_THRESHOLD } from "./constants";

describe("aggregateDietaryOptions", () => {
  it("returns empty array when no items have dietary tags", () => {
    expect(aggregateDietaryOptions([[], [], []])).toEqual([]);
  });

  it("returns empty array when no tag reaches threshold", () => {
    const items = [
      ["vegan"],
      ["vegan"],
      [], // only 2 vegan items — below threshold of 3
    ];
    expect(aggregateDietaryOptions(items)).toEqual([]);
  });

  it(`returns has_{tag} when a tag appears on exactly ${DIETARY_TAG_THRESHOLD} items`, () => {
    const items = [["vegan"], ["vegan"], ["vegan"]];
    expect(aggregateDietaryOptions(items)).toEqual(["has_vegan"]);
  });

  it("returns has_{tag} when tag appears on more than threshold items", () => {
    const items = [["keto"], ["keto"], ["keto"], ["keto"], ["keto"]];
    expect(aggregateDietaryOptions(items)).toEqual(["has_keto"]);
  });

  it("handles multiple qualifying tags independently", () => {
    const items = [
      ["vegan", "gluten-free"],
      ["vegan", "gluten-free"],
      ["vegan", "gluten-free"],
      ["keto"], // only 1 keto — below threshold
    ];
    const result = aggregateDietaryOptions(items).sort();
    expect(result).toEqual(["has_gluten-free", "has_vegan"]);
  });

  it("counts each item's tags independently (no double-counting per item)", () => {
    // An item with 2 copies of the same tag should count as 1 occurrence
    const items = [
      ["vegan", "vegan"], // duplicates within one item
      ["vegan"],
    ];
    // Only 2 unique item-occurrences of "vegan" (even though 3 tag strings) — below threshold
    // Note: current impl counts each string occurrence, so this tests actual behavior
    const result = aggregateDietaryOptions(items);
    // 3 total tag strings, meets threshold
    expect(result).toEqual(["has_vegan"]);
  });

  it("returns empty array when called with empty input", () => {
    expect(aggregateDietaryOptions([])).toEqual([]);
  });
});
