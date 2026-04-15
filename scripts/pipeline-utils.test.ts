jest.mock("./constants", () => ({
  aggregateDietaryOptions: jest.fn().mockReturnValue([]),
}));

import { validateItems, checkMacroMismatch, namesMatch, dedupByName, decodeHtml } from "./pipeline-utils";
import type { MacroData, StructuredMenuItem } from "../apps/api/services/menuSources/types";

function makeMacro(overrides: Partial<MacroData> = {}): MacroData {
  return {
    calories: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 20,
    confidence: "MEDIUM",
    source: "haiku",
    dietaryTags: [],
    ...overrides,
  };
}

function makeItem(name: string, overrides: Partial<StructuredMenuItem> = {}): StructuredMenuItem {
  return { name, ...overrides };
}

describe("validateItems", () => {
  it("passes normal food items through", () => {
    const items = [makeItem("Chicken Teriyaki Bowl")];
    const macros = [makeMacro()];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects merchandise items", () => {
    const items = [makeItem("Pine & Crane T-Shirt"), makeItem("Logo Hoodie"), makeItem("Ceramic Mug")];
    const macros = items.map(() => makeMacro());
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(3);
    expect(rejected.every((r) => r.reason === "non-food: merchandise")).toBe(true);
  });

  it("rejects utensil items", () => {
    const items = [makeItem("Bamboo Chopstick Set"), makeItem("Extra Fork")];
    const macros = items.map(() => makeMacro());
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.reason === "non-food: utensil")).toBe(true);
  });

  it("rejects zero-cal non-beverage items", () => {
    const items = [makeItem("Decorative Topping")];
    const macros = [makeMacro({ calories: 0 })];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(0);
    expect(rejected[0]!.reason).toBe("non-food: zero calories");
  });

  it("allows zero-cal beverages", () => {
    const items = [makeItem("Sparkling Water"), makeItem("Unsweetened Iced Tea"), makeItem("Black Coffee")];
    const macros = items.map(() => makeMacro({ calories: 0 }));
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(3);
    expect(rejected).toHaveLength(0);
  });

  it("rejects condiments under 30 cal", () => {
    const items = [makeItem("Ketchup Packet"), makeItem("Soy Sauce"), makeItem("Mayo")];
    const macros = items.map(() => makeMacro({ calories: 15 }));
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(0);
    expect(rejected.every((r) => r.reason === "condiment")).toBe(true);
  });

  it("allows condiment-named items with >= 30 cal (e.g. large sauce portions)", () => {
    const items = [makeItem("Hot Sauce Wings")];
    const macros = [makeMacro({ calories: 350 })];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("skips items with null macros", () => {
    const items = [makeItem("Mystery Item"), makeItem("Good Burger")];
    const macros: (MacroData | null)[] = [null, makeMacro()];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.item.name).toBe("Good Burger");
  });

  it("handles mixed valid and invalid items", () => {
    const items = [
      makeItem("Pad Thai"),
      makeItem("Logo Tote Bag"),
      makeItem("Sparkling Water"),
      makeItem("Ketchup Packet"),
      makeItem("Grilled Salmon"),
    ];
    const macros = [
      makeMacro({ calories: 600 }),
      makeMacro({ calories: 0 }),
      makeMacro({ calories: 0 }),
      makeMacro({ calories: 10 }),
      makeMacro({ calories: 450 }),
    ];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(3); // Pad Thai, Sparkling Water, Grilled Salmon
    expect(rejected).toHaveLength(2); // Tote Bag, Ketchup Packet
  });

  it("flags macro math mismatches above 20% (S-121)", () => {
    const items = [makeItem("Suspicious Salad")];
    // cal=500, but p*4+c*4+f*9 = 10*4+10*4+10*9 = 170 → delta=330 → 66%
    const macros = [makeMacro({ calories: 500, proteinG: 10, carbsG: 10, fatG: 10 })];
    const { valid, macroMismatches } = validateItems(items, macros);
    expect(valid).toHaveLength(1); // still passes (flag only, not rejected)
    expect(macroMismatches).toHaveLength(1);
    expect(macroMismatches[0]!.name).toBe("Suspicious Salad");
    expect(macroMismatches[0]!.percentDelta).toBeGreaterThan(20);
  });

  it("does not flag macro math within 20% threshold", () => {
    const items = [makeItem("Normal Burger")];
    // cal=500, p*4+c*4+f*9 = 30*4+50*4+20*9 = 120+200+180 = 500 → 0%
    const macros = [makeMacro({ calories: 500, proteinG: 30, carbsG: 50, fatG: 20 })];
    const { macroMismatches } = validateItems(items, macros);
    expect(macroMismatches).toHaveLength(0);
  });
});

describe("checkMacroMismatch", () => {
  it("returns null for matching macros", () => {
    const macro = makeMacro({ calories: 500, proteinG: 30, carbsG: 50, fatG: 20 });
    expect(checkMacroMismatch(macro)).toBeNull();
  });

  it("returns mismatch info for divergent macros", () => {
    const macro = makeMacro({ calories: 800, proteinG: 10, carbsG: 10, fatG: 10 });
    const result = checkMacroMismatch(macro);
    expect(result).not.toBeNull();
    expect(result!.percentDelta).toBeGreaterThan(20);
  });

  it("returns null for zero calorie items", () => {
    const macro = makeMacro({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    expect(checkMacroMismatch(macro)).toBeNull();
  });
});

describe("dedupByName (S-133)", () => {
  it("returns all items when no duplicates", () => {
    const pairs = [
      { item: makeItem("Chicken Bowl"), macro: makeMacro() },
      { item: makeItem("Beef Burrito"), macro: makeMacro() },
    ];
    const result = dedupByName(pairs);
    expect(result).toHaveLength(2);
  });

  it("removes case-insensitive duplicate names, keeping first occurrence", () => {
    const macro1 = makeMacro({ calories: 500 });
    const macro2 = makeMacro({ calories: 700 });
    const pairs = [
      { item: makeItem("Chicken Bowl"), macro: macro1 },
      { item: makeItem("chicken bowl"), macro: macro2 },
      { item: makeItem("CHICKEN BOWL"), macro: makeMacro() },
    ];
    const result = dedupByName(pairs);
    expect(result).toHaveLength(1);
    expect(result[0]!.item.name).toBe("Chicken Bowl");
    expect(result[0]!.macro.calories).toBe(500);
  });

  it("handles empty input", () => {
    expect(dedupByName([])).toHaveLength(0);
  });

  it("deduplicates Chick-fil-A items from multiple sources", () => {
    const pairs = [
      { item: makeItem("Chick-fil-A Chicken Sandwich"), macro: makeMacro() },
      { item: makeItem("Waffle Fries"), macro: makeMacro() },
      { item: makeItem("chick-fil-a chicken sandwich"), macro: makeMacro() },
      { item: makeItem("Lemonade"), macro: makeMacro() },
      { item: makeItem("waffle fries"), macro: makeMacro() },
    ];
    const result = dedupByName(pairs);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.item.name)).toEqual([
      "Chick-fil-A Chicken Sandwich",
      "Waffle Fries",
      "Lemonade",
    ]);
  });

  it("preserves order of first occurrences", () => {
    const pairs = [
      { item: makeItem("Zeta"), macro: makeMacro() },
      { item: makeItem("Alpha"), macro: makeMacro() },
      { item: makeItem("zeta"), macro: makeMacro() },
      { item: makeItem("Beta"), macro: makeMacro() },
    ];
    const result = dedupByName(pairs);
    expect(result.map((r) => r.item.name)).toEqual(["Zeta", "Alpha", "Beta"]);
  });
});

describe("decodeHtml", () => {
  it("returns null for null input", () => {
    expect(decodeHtml(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(decodeHtml(undefined)).toBeNull();
  });

  it("passes through plain text unchanged", () => {
    expect(decodeHtml("Chicken Bowl")).toBe("Chicken Bowl");
  });

  it("decodes &amp;", () => {
    expect(decodeHtml("Ben &amp; Jerry&#39;s")).toBe("Ben & Jerry's");
  });

  it("decodes &lt; and &gt;", () => {
    expect(decodeHtml("&lt;b&gt;Bold&lt;/b&gt;")).toBe("<b>Bold</b>");
  });

  it("decodes &quot;", () => {
    expect(decodeHtml("She said &quot;hi&quot;")).toBe('She said "hi"');
  });

  it("decodes &#x27; and &#x2F;", () => {
    expect(decodeHtml("path&#x2F;to&#x27;file")).toBe("path/to'file");
  });

  it("decodes multiple entities in one string", () => {
    expect(decodeHtml("Pine &amp; Crane &#39;s &quot;Best&quot;")).toBe(
      "Pine & Crane 's \"Best\"",
    );
  });
});

describe("namesMatch (S-118)", () => {
  it("matches exact names", () => {
    expect(namesMatch("Sqirl", "Sqirl")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(namesMatch("SQIRL", "sqirl")).toBe(true);
  });

  it("matches substring containment", () => {
    expect(namesMatch("Pine & Crane", "Pine & Crane - Silver Lake")).toBe(true);
  });

  it("matches with word overlap", () => {
    expect(namesMatch("Guisados Tacos", "Guisados")).toBe(true);
  });

  it("detects mismatch", () => {
    expect(namesMatch("Sqirl", "Taoxi Asian Cuisine")).toBe(false);
  });
});
