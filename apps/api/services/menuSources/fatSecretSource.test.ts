import * as fs from "fs";
import * as path from "path";

// ─── Mock fetch before importing source ───────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import {
  FatSecretSource,
  parseFatSecretPage,
  parseMacroLine,
  toFatSecretSlug,
} from "./fatSecretSource";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, "__fixtures__", name),
    "utf-8",
  );
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── toFatSecretSlug ─────────────────────────────────────────────────────────

describe("toFatSecretSlug", () => {
  it("lowercases and strips apostrophes", () => {
    expect(toFatSecretSlug("McDonald's")).toBe("mcdonalds");
  });

  it("preserves hyphens", () => {
    expect(toFatSecretSlug("Chick-fil-A")).toBe("chick-fil-a");
  });

  it("collapses consecutive dashes", () => {
    expect(toFatSecretSlug("Pizza  Hut")).toBe("pizza-hut");
  });

  it("handles Taco Bell", () => {
    expect(toFatSecretSlug("Taco Bell")).toBe("taco-bell");
  });

  it("handles plain lowercase names", () => {
    expect(toFatSecretSlug("subway")).toBe("subway");
  });
});

// ─── parseMacroLine ──────────────────────────────────────────────────────────

describe("parseMacroLine", () => {
  it("extracts all four macros from standard format", () => {
    const line =
      "Per 1 serving - Calories: 590kcal | Fat: 34.00g | Carbs: 45.00g | Protein: 25.00g";
    const result = parseMacroLine(line);
    expect(result.calories).toBe(590);
    expect(result.fatG).toBe(34);
    expect(result.carbsG).toBe(45);
    expect(result.proteinG).toBe(25);
  });

  it("handles zero values", () => {
    const line =
      "Per 1 serving - Calories: 0kcal | Fat: 0.00g | Carbs: 0.00g | Protein: 0.00g";
    const result = parseMacroLine(line);
    expect(result.calories).toBe(0);
    expect(result.fatG).toBe(0);
    expect(result.carbsG).toBe(0);
    expect(result.proteinG).toBe(0);
  });

  it("handles decimal calories", () => {
    const line =
      "Per 1 serving - Calories: 12.5kcal | Fat: 1.00g | Carbs: 0.50g | Protein: 0.25g";
    const result = parseMacroLine(line);
    expect(result.calories).toBe(12.5);
  });

  it("returns empty object for unrecognized text", () => {
    const result = parseMacroLine("Nothing useful here");
    expect(result.calories).toBeUndefined();
    expect(result.fatG).toBeUndefined();
    expect(result.carbsG).toBeUndefined();
    expect(result.proteinG).toBeUndefined();
  });
});

// ─── parseFatSecretPage ──────────────────────────────────────────────────────

describe("parseFatSecretPage", () => {
  it("extracts items from McDonald's fixture", () => {
    const html = fixture("fatsecret-mcdonalds.html");
    const items = parseFatSecretPage(html);
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it("extracts Big Mac macros correctly", () => {
    const html = fixture("fatsecret-mcdonalds.html");
    const items = parseFatSecretPage(html);
    const bigMac = items.find((i) => i.name === "Big Mac");
    expect(bigMac).toBeDefined();
    expect(bigMac?.macros.calories).toBe(590);
    expect(bigMac?.macros.proteinG).toBe(25);
    expect(bigMac?.macros.carbsG).toBe(45);
    expect(bigMac?.macros.fatG).toBe(34);
  });

  it("extracts Egg McMuffin macros correctly", () => {
    const html = fixture("fatsecret-mcdonalds.html");
    const items = parseFatSecretPage(html);
    const eggMcMuffin = items.find((i) => i.name === "Egg McMuffin");
    expect(eggMcMuffin).toBeDefined();
    expect(eggMcMuffin?.macros.calories).toBe(310);
    expect(eggMcMuffin?.macros.proteinG).toBe(17);
  });

  it("includes section names from h2 headers", () => {
    const html = fixture("fatsecret-mcdonalds.html");
    const items = parseFatSecretPage(html);
    const bigMac = items.find((i) => i.name === "Big Mac");
    expect(bigMac?.section).toBe("Burgers");
  });

  it("sets source to fatsecret and confidence to HIGH", () => {
    const html = fixture("fatsecret-mcdonalds.html");
    const items = parseFatSecretPage(html);
    const first = items[0];
    expect(first?.macros.source).toBe("fatsecret");
    expect(first?.macros.confidence).toBe("HIGH");
  });

  it("returns empty array for page with no items", () => {
    const items = parseFatSecretPage("<html><body><p>Nothing here</p></body></html>");
    expect(items).toHaveLength(0);
  });
});

// ─── FatSecretSource.lookup ──────────────────────────────────────────────────

describe("FatSecretSource", () => {
  const source = new FatSecretSource();

  it("has id fatsecret", () => {
    expect(source.id).toBe("fatsecret");
  });

  it("returns found: true with macros for known chain", async () => {
    const html = fixture("fatsecret-mcdonalds.html");
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(html),
    });

    const result = await source.lookup("McDonald's", "Los Angeles, CA");
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("fatsecret");
    expect(result.macros).toBeDefined();
    expect(result.macros!.size).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("includes section on items", async () => {
    const html = fixture("fatsecret-mcdonalds.html");
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(html),
    });

    const result = await source.lookup("McDonald's", "Los Angeles, CA");
    const burgerItem = result.items.find((i) => i.section === "Burgers");
    expect(burgerItem).toBeDefined();
  });

  it("macros map is keyed by lowercased name", async () => {
    const html = fixture("fatsecret-mcdonalds.html");
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(html),
    });

    const result = await source.lookup("McDonald's", "Los Angeles, CA");
    expect(result.macros!.has("big mac")).toBe(true);
  });

  it("returns found: false on non-200 response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await source.lookup("Unknown Restaurant", "Anywhere");
    expect(result.found).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it("returns found: false on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await source.lookup("Some Place", "Anywhere");
    expect(result.found).toBe(false);
  });

  it("returns found: false for page with no items", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue("<html><body><p>Nothing</p></body></html>"),
    });

    const result = await source.lookup("NonChain", "Los Angeles");
    expect(result.found).toBe(false);
  });

  it("returns found: false when page contains 'No results found'", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest
        .fn()
        .mockResolvedValue("<html><body><p>No results found</p></body></html>"),
    });

    const result = await source.lookup("Ghost Restaurant", "LA");
    expect(result.found).toBe(false);
  });
});
