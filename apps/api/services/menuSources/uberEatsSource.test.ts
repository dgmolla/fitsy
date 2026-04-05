import * as fs from "fs";
import * as path from "path";

// ─── Mock fetch before importing source ───────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import {
  UberEatsSource,
  extractJsonLdBlocks,
  findRestaurantBlock,
  parseMenuItems,
  toUberEatsSearchUrl,
} from "./uberEatsSource";

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

// ─── extractJsonLdBlocks ──────────────────────────────────────────────────────

describe("extractJsonLdBlocks", () => {
  it("extracts a single JSON-LD block", () => {
    const html = `<script type="application/ld+json">{"@type":"Restaurant","name":"Test"}</script>`;
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Record<string, unknown>)["@type"]).toBe("Restaurant");
  });

  it("extracts multiple JSON-LD blocks", () => {
    const html = `
      <script type="application/ld+json">{"@type":"WebSite"}</script>
      <script type="application/ld+json">{"@type":"Restaurant","name":"Foo"}</script>
    `;
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(2);
  });

  it("skips malformed JSON-LD", () => {
    const html = `<script type="application/ld+json">NOT VALID JSON</script>`;
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(0);
  });

  it("returns empty array when no script tags present", () => {
    const blocks = extractJsonLdBlocks("<html><body><p>No scripts</p></body></html>");
    expect(blocks).toHaveLength(0);
  });

  it("handles single-quoted type attribute", () => {
    const html = `<script type='application/ld+json'>{"@type":"Restaurant","name":"Test"}</script>`;
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(1);
  });
});

// ─── findRestaurantBlock ──────────────────────────────────────────────────────

describe("findRestaurantBlock", () => {
  it("finds a Restaurant block from blocks array", () => {
    const blocks = [
      { "@type": "WebSite", "name": "Uber Eats" },
      { "@type": "Restaurant", "name": "Thai Orchid", "hasMenu": { "@type": "Menu", "hasMenuSection": [] } },
    ];
    const found = findRestaurantBlock(blocks);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("Thai Orchid");
  });

  it("returns null when no Restaurant block found", () => {
    const blocks = [
      { "@type": "WebSite" },
      { "@type": "BreadcrumbList" },
    ];
    const found = findRestaurantBlock(blocks);
    expect(found).toBeNull();
  });

  it("returns null for empty blocks array", () => {
    expect(findRestaurantBlock([])).toBeNull();
  });

  it("ignores Restaurant without hasMenu", () => {
    const blocks = [{ "@type": "Restaurant", "name": "Incomplete" }];
    const found = findRestaurantBlock(blocks);
    expect(found).toBeNull();
  });
});

// ─── parseMenuItems ───────────────────────────────────────────────────────────

describe("parseMenuItems", () => {
  it("parses items from fixture JSON-LD", () => {
    const html = fixture("ubereats-thai-place.html");
    const blocks = extractJsonLdBlocks(html);
    const restaurant = findRestaurantBlock(blocks)!;
    const items = parseMenuItems(restaurant);

    expect(items.length).toBe(5); // 2 appetizers + 3 entrees
  });

  it("extracts name, description, price, and section", () => {
    const html = fixture("ubereats-thai-place.html");
    const blocks = extractJsonLdBlocks(html);
    const restaurant = findRestaurantBlock(blocks)!;
    const items = parseMenuItems(restaurant);

    const padThai = items.find((i) => i.name === "Pad Thai");
    expect(padThai).toBeDefined();
    expect(padThai?.description).toContain("rice noodles");
    expect(padThai?.price).toBe(18.0);
    expect(padThai?.section).toBe("Entrees");
  });

  it("groups items under correct sections", () => {
    const html = fixture("ubereats-thai-place.html");
    const blocks = extractJsonLdBlocks(html);
    const restaurant = findRestaurantBlock(blocks)!;
    const items = parseMenuItems(restaurant);

    const appetizers = items.filter((i) => i.section === "Appetizers");
    const entrees = items.filter((i) => i.section === "Entrees");
    expect(appetizers).toHaveLength(2);
    expect(entrees).toHaveLength(3);
  });

  it("returns empty array when menu sections are empty", () => {
    const restaurant = {
      "@type": "Restaurant" as const,
      name: "Empty",
      hasMenu: { "@type": "Menu" as const, hasMenuSection: [] },
    };
    const items = parseMenuItems(restaurant);
    expect(items).toHaveLength(0);
  });

  it("handles single menu section (not array)", () => {
    const restaurant = {
      "@type": "Restaurant" as const,
      name: "Test",
      hasMenu: {
        "@type": "Menu" as const,
        hasMenuSection: {
          "@type": "MenuSection" as const,
          name: "Mains",
          hasMenuItem: [{ "@type": "MenuItem" as const, name: "Burger" }],
        },
      },
    };
    const items = parseMenuItems(restaurant);
    expect(items).toHaveLength(1);
    const firstItem = items[0];
    expect(firstItem?.name).toBe("Burger");
    expect(firstItem?.section).toBe("Mains");
  });
});

// ─── toUberEatsSearchUrl ──────────────────────────────────────────────────────

describe("toUberEatsSearchUrl", () => {
  it("builds a URL with encoded name and address", () => {
    const url = toUberEatsSearchUrl("Thai Orchid", "2301 Hyperion Ave, Los Angeles");
    expect(url).toContain("ubereats.com");
    expect(url).toContain("Thai+Orchid");
  });
});

// ─── UberEatsSource.lookup ────────────────────────────────────────────────────

describe("UberEatsSource", () => {
  const source = new UberEatsSource();

  it("has id ubereats", () => {
    expect(source.id).toBe("ubereats");
  });

  it("returns found: true with items from restaurant page", async () => {
    const html = fixture("ubereats-thai-place.html");
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(html),
    });

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("ubereats");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.macros).toBeUndefined(); // no macros from UE
  });

  it("returns restaurant metadata", async () => {
    const html = fixture("ubereats-thai-place.html");
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(html),
    });

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.restaurant?.name).toBe("Thai Orchid");
    expect(result.restaurant?.cuisine).toContain("Thai");
    expect(result.restaurant?.priceRange).toBe("$$");
  });

  it("falls back to search URL when store page has no menu", async () => {
    const noMenuHtml = fixture("ubereats-no-menu.html");
    const menuHtml = fixture("ubereats-thai-place.html");

    // First call (slug URL) returns no menu, second (search URL) returns menu
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(noMenuHtml),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(menuHtml),
      });

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.found).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns found: false when both fetch attempts fail with no JSON-LD", async () => {
    const noMenuHtml = fixture("ubereats-no-menu.html");
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(noMenuHtml),
    });

    const result = await source.lookup("Unknown Place", "LA");
    expect(result.found).toBe(false);
  });

  it("returns found: false on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await source.lookup("Test", "Anywhere");
    expect(result.found).toBe(false);
  });

  it("returns found: false on non-200 response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await source.lookup("Test", "Anywhere");
    expect(result.found).toBe(false);
  });
});
