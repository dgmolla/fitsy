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
  parseUberEatsMarkdown,
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

// ─── parseUberEatsMarkdown ────────────────────────────────────────────────────

describe("parseUberEatsMarkdown", () => {
  it("extracts item name and calories from Firecrawl markdown format", () => {
    const markdown = `
- [![Chicken Sandwich](https://tb-static.uber.com/img.jpeg)\\
\\
Chicken Sandwich\\
\\
$5.79 • 440 Cal.](https://www.ubereats.com/store/test/AbCd?mod=quickView)
`;
    const items = parseUberEatsMarkdown(markdown);
    expect(items.length).toBeGreaterThan(0);
    const sandwich = items.find((i) => i.name === "Chicken Sandwich");
    expect(sandwich).toBeDefined();
    expect(sandwich?.calories).toBe(440);
  });

  it("uses lower bound for calorie ranges", () => {
    const markdown = `
- [![Happy Meal](https://img.jpg)\\
Happy Meal\\
$5.99 • 430 - 530 Cal.](https://ubereats.com/store/test/XYZ)
`;
    const items = parseUberEatsMarkdown(markdown);
    const happyMeal = items.find((i) => i.name === "Happy Meal");
    expect(happyMeal?.calories).toBe(430);
  });

  it("deduplicates items that appear multiple times (featured + section)", () => {
    const markdown = `
- [![Big Mac](https://img.jpg)\\
Big Mac\\
$5.29 • 540 Cal.](https://ubereats.com/store/test/XYZ)

- [![Big Mac](https://img.jpg)\\
Big Mac\\
$5.29 • 540 Cal.](https://ubereats.com/store/test/XYZ2)
`;
    const items = parseUberEatsMarkdown(markdown);
    const bigMacs = items.filter((i) => i.name === "Big Mac");
    expect(bigMacs).toHaveLength(1);
  });

  it("returns empty array for markdown with no calorie data", () => {
    const items = parseUberEatsMarkdown("<html><body>No menu here</body></html>");
    expect(items).toHaveLength(0);
  });

  it("skips badge lines starting with # (e.g. '#1 most liked')", () => {
    const markdown = `
- [![Fries](https://img.jpg)\\
#1 most liked\\
\\
Medium French Fries\\
\\
$3.99 • 320 Cal.](https://ubereats.com/store/test/XYZ)
`;
    const items = parseUberEatsMarkdown(markdown);
    // Should get "Medium French Fries", not "#1 most liked"
    const fries = items.find((i) => i.name === "Medium French Fries");
    expect(fries).toBeDefined();
    expect(fries?.calories).toBe(320);
    const badge = items.find((i) => i.name.startsWith("#"));
    expect(badge).toBeUndefined();
  });
});

// ─── UberEatsSource.lookup ────────────────────────────────────────────────────

describe("UberEatsSource", () => {
  const source = new UberEatsSource();

  beforeEach(() => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
  });

  afterEach(() => {
    delete process.env["FIRECRAWL_API_KEY"];
  });

  it("has id ubereats", () => {
    expect(source.id).toBe("ubereats");
  });

  it("returns found: true when JSON-LD extraction succeeds", async () => {
    const jsonLdHtml = fixture("ubereats-thai-place.html");

    mockFetch
      // Step 1: Firecrawl URL discovery
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ url: "https://www.ubereats.com/store/thai-orchid/AbCd1234" }],
        }),
      })
      // Step 2: Raw fetch for JSON-LD
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(jsonLdHtml),
      });

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("ubereats");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.description).toBeDefined();
    expect(result.items[0]?.price).toBeDefined();
    expect(result.items[0]?.section).toBeDefined();
    expect(result.macros).toBeUndefined();
  });

  it("returns restaurant name from JSON-LD block", async () => {
    const jsonLdHtml = fixture("ubereats-thai-place.html");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ url: "https://www.ubereats.com/store/thai-orchid/AbCd1234" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(jsonLdHtml),
      });

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.restaurant?.name).toBeDefined();
  });

  it("falls back to Firecrawl markdown when JSON-LD is absent", async () => {
    const noMenuHtml = fixture("ubereats-no-menu.html");
    const markdown = `
- [![Pad Thai](https://img.jpg)\\
Pad Thai\\
$18.00 • 620 Cal.](https://www.ubereats.com/store/thai-orchid/AbCd1234)
`;

    mockFetch
      // Step 1: Firecrawl URL discovery
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ url: "https://www.ubereats.com/store/thai-orchid/AbCd1234" }],
        }),
      })
      // Step 2: Raw fetch — no JSON-LD menu
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(noMenuHtml),
      })
      // Step 3: Firecrawl markdown fallback
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: { markdown } }),
      });

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.found).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.calories).toBeDefined();
  });

  it("returns found: false when Firecrawl search returns no matching store URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: [{ url: "https://www.ubereats.com" }] }),
    });

    const result = await source.lookup("Unknown Place", "LA");
    expect(result.found).toBe(false);
  });

  it("returns found: false when Firecrawl API key is absent", async () => {
    delete process.env["FIRECRAWL_API_KEY"];

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.found).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns found: false on Firecrawl network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await source.lookup("Test", "Anywhere");
    expect(result.found).toBe(false);
  });

  it("returns found: false when both JSON-LD and Firecrawl markdown have no items", async () => {
    const noMenuHtml = fixture("ubereats-no-menu.html");

    mockFetch
      // Step 1: Firecrawl URL discovery
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ url: "https://www.ubereats.com/store/thai-orchid/AbCd1234" }],
        }),
      })
      // Step 2: Raw fetch — no JSON-LD menu
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(noMenuHtml),
      })
      // Step 3: Firecrawl markdown — also no items
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: { markdown: "<html>No menu</html>" } }),
      });

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.found).toBe(false);
  });
});
