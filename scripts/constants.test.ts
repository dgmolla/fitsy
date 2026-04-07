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

  it("counts duplicate tags within a single item as one vote", () => {
    // An item with ["vegan", "vegan"] should count as 1 item signalling vegan,
    // not 2 — one item = one vote per tag
    const items = [
      ["vegan", "vegan"], // duplicate within one item = 1 vote
      ["vegan"],          // 1 vote
    ];
    // Only 2 unique item-votes for "vegan" — below threshold of 3
    const result = aggregateDietaryOptions(items);
    expect(result).toEqual([]);
  });

  it("returns empty array when called with empty input", () => {
    expect(aggregateDietaryOptions([])).toEqual([]);
  });
});
