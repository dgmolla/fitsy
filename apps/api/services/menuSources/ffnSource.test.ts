import * as fs from "fs";
import * as path from "path";

// ─── Mock fetch before importing source ───────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { FFNSource, parseFFNPage, parseFFNTableRow, toFFNSlug } from "./ffnSource";

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

// ─── toFFNSlug ────────────────────────────────────────────────────────────────

describe("toFFNSlug", () => {
  it("lowercases and strips apostrophes", () => {
    expect(toFFNSlug("McDonald's")).toBe("mcdonalds");
  });

  it("replaces spaces with dashes", () => {
    expect(toFFNSlug("Chick-fil-A")).toBe("chick-fil-a");
  });

  it("collapses consecutive dashes", () => {
    expect(toFFNSlug("Pizza  Hut")).toBe("pizza-hut");
  });

  it("handles Taco Bell", () => {
    expect(toFFNSlug("Taco Bell")).toBe("taco-bell");
  });

  it("handles plain lowercase names", () => {
    expect(toFFNSlug("subway")).toBe("subway");
  });
});

// ─── parseFFNTableRow ─────────────────────────────────────────────────────────

describe("parseFFNTableRow", () => {
  it("extracts calories from title attribute", () => {
    const html = `<td title="Calories in a McDonald's Big Mac">540</td>`;
    const result = parseFFNTableRow(html);
    expect(result.calories).toBe(540);
  });

  it("extracts protein", () => {
    const html = `<td title="Protein in a McDonald's Big Mac">25</td>`;
    const result = parseFFNTableRow(html);
    expect(result.proteinG).toBe(25);
  });

  it("extracts carbs from 'carb' title", () => {
    const html = `<td title="Total Carbohydrate in a McDonald's Big Mac">45</td>`;
    const result = parseFFNTableRow(html);
    expect(result.carbsG).toBe(45);
  });

  it("extracts total fat but not saturated fat", () => {
    const html = `
      <td title="Total Fat in a McDonald's Big Mac">30</td>
      <td title="Saturated Fat in a McDonald's Big Mac">11</td>
    `;
    const result = parseFFNTableRow(html);
    expect(result.fatG).toBe(30);
  });

  it("returns empty object for unrecognized HTML", () => {
    const result = parseFFNTableRow("<td>No title here</td>");
    expect(result.calories).toBeUndefined();
    expect(result.proteinG).toBeUndefined();
  });

  it("handles decimal values", () => {
    const html = `<td title="Protein in a test item">12.5</td>`;
    const result = parseFFNTableRow(html);
    expect(result.proteinG).toBe(12.5);
  });
});

// ─── parseFFNPage ─────────────────────────────────────────────────────────────

describe("parseFFNPage", () => {
  it("extracts items and macros from McDonald's fixture", () => {
    const html = fixture("ffn-mcdonalds.html");
    const macros = parseFFNPage(html);

    expect(macros.size).toBeGreaterThanOrEqual(2);
  });

  it("extracts Big Mac macros correctly", () => {
    const html = fixture("ffn-mcdonalds.html");
    const macros = parseFFNPage(html);

    // Key is lowercased item name (stripped of HTML tags)
    const bigMac = macros.get("big mac");
    expect(bigMac).toBeDefined();
    expect(bigMac?.calories).toBe(550);
    expect(bigMac?.proteinG).toBe(25);
    expect(bigMac?.carbsG).toBe(45);
    expect(bigMac?.fatG).toBe(30);
  });

  it("sets source to ffn and confidence to HIGH", () => {
    const html = fixture("ffn-mcdonalds.html");
    const macros = parseFFNPage(html);
    const first = macros.values().next().value;
    expect(first?.source).toBe("ffn");
    expect(first?.confidence).toBe("HIGH");
  });

  it("returns empty map for page with no nutrition tables", () => {
    const macros = parseFFNPage("<html><body><p>Nothing here</p></body></html>");
    expect(macros.size).toBe(0);
  });
});

// ─── FFNSource.lookup ─────────────────────────────────────────────────────────

describe("FFNSource", () => {
  const source = new FFNSource();

  it("has id ffn", () => {
    expect(source.id).toBe("ffn");
  });

  it("returns found: true with macros for known chain", async () => {
    const html = fixture("ffn-mcdonalds.html");
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(html),
    });

    const result = await source.lookup("McDonald's", "Los Angeles, CA");
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("ffn");
    expect(result.macros).toBeDefined();
    expect(result.macros!.size).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
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

  it("returns found: false when page contains 404 marker", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue("<html><body><h1>Page Not Found</h1></body></html>"),
    });

    const result = await source.lookup("Ghost Restaurant", "LA");
    expect(result.found).toBe(false);
  });
});
