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
  fetchUberEatsHtml,
  scrapeUberEatsViaFirecrawl,
  isBotDefensePage,
  extractMenuViaJsonLd,
  extractMenuViaFirecrawl,
  scrapeUberEatsMarkdown,
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
      // Firecrawl URL discovery
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ url: "https://www.ubereats.com/store/thai-orchid/AbCd1234" }],
        }),
      })
      // Raw fetch for JSON-LD
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

  it("returns found: false when slug guess and Firecrawl both fail", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 }) // slug guess
      .mockResolvedValueOnce({ // Firecrawl discovery — no UE match
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [{ url: "https://www.ubereats.com" }] }),
      });

    const result = await source.lookup("Unknown Place", "LA");
    expect(result.found).toBe(false);
  });

  it("returns found: false when Firecrawl API key is absent and slug fails", async () => {
    delete process.env["FIRECRAWL_API_KEY"];

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 }); // slug guess

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.found).toBe(false);
  });

  it("returns found: false on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await source.lookup("Test", "Anywhere");
    expect(result.found).toBe(false);
  });

  it("returns found: false when all discovery methods find no menu", async () => {
    const noMenuHtml = fixture("ubereats-no-menu.html");

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 }) // slug guess
      .mockResolvedValueOnce({ // Firecrawl discovery
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ url: "https://www.ubereats.com/store/thai-orchid/AbCd1234" }],
        }),
      })
      .mockResolvedValueOnce({ // Raw fetch — no JSON-LD
        ok: true,
        text: jest.fn().mockResolvedValue(noMenuHtml),
      });

    const result = await source.lookup("Thai Orchid", "2301 Hyperion Ave, LA");
    expect(result.found).toBe(false);
  });

  it("returns items from cached URL when constructor storeUrl is provided", async () => {
    const jsonLdHtml = fixture("ubereats-thai-place.html");
    const sourceWithUrl = new UberEatsSource("https://www.ubereats.com/store/thai-orchid/AbCd1234");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValue(jsonLdHtml),
    });

    const result = await sourceWithUrl.lookup("Thai Orchid", "LA");
    expect(result.found).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("falls through from cached URL to later steps when JSON-LD is absent", async () => {
    const noMenuHtml = fixture("ubereats-no-menu.html");
    const jsonLdHtml = fixture("ubereats-thai-place.html");
    const sourceWithUrl = new UberEatsSource("https://www.ubereats.com/store/wrong/XYZ");

    mockFetch
      // Step 1: cached URL — no JSON-LD
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(noMenuHtml),
      })
      // Step 4: Brave search — no match (Firecrawl discovery)
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ url: "https://www.ubereats.com/store/thai-orchid/AbCd1234" }],
        }),
      })
      // Step 5: Raw fetch for Firecrawl-discovered URL
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(jsonLdHtml),
      });

    const result = await sourceWithUrl.lookup("Thai Orchid", "LA");
    expect(result.found).toBe(true);
  });

  it("resolves from urlCache when available", async () => {
    const jsonLdHtml = fixture("ubereats-thai-place.html");
    const sourceWithCache = new UberEatsSource();
    sourceWithCache.urlCache = new Map([["Thai Orchid", "https://www.ubereats.com/store/thai-orchid/AbCd"]]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValue(jsonLdHtml),
    });

    const result = await sourceWithCache.lookup("Thai Orchid", "LA");
    expect(result.found).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("resolves from sitemapIndex when available", async () => {
    const jsonLdHtml = fixture("ubereats-thai-place.html");
    const mockSitemapIndex = { findUrl: jest.fn().mockReturnValue("https://www.ubereats.com/store/thai-orchid/AbCd") };
    const sourceWithSitemap = new UberEatsSource(undefined, mockSitemapIndex as unknown as import("./ueSitemapIndex").UESitemapIndex);
    sourceWithSitemap.urlCache = new Map();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValue(jsonLdHtml),
    });

    const result = await sourceWithSitemap.lookup("Thai Orchid", "LA");
    expect(result.found).toBe(true);
    expect(sourceWithSitemap.urlCache.get("Thai Orchid")).toBe("https://www.ubereats.com/store/thai-orchid/AbCd");
  });

  it("logs and skips sitemap when no slug match found", async () => {
    const mockSitemapIndex = { findUrl: jest.fn().mockReturnValue(null) };
    const sourceWithSitemap = new UberEatsSource(undefined, mockSitemapIndex as unknown as import("./ueSitemapIndex").UESitemapIndex);

    mockFetch
      // Brave discovery — no match
      .mockResolvedValueOnce({ ok: false, status: 500 })
      // Firecrawl discovery — no match
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

    const result = await sourceWithSitemap.lookup("Nonexistent", "LA");
    expect(result.found).toBe(false);
    expect(mockSitemapIndex.findUrl).toHaveBeenCalledWith("Nonexistent");
  });
});

// ─── fetchUberEatsHtml ──────────────────────────────────────────────────────

describe("fetchUberEatsHtml", () => {
  it("returns HTML on successful fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue("<html>menu</html>"),
    });
    const result = await fetchUberEatsHtml("https://www.ubereats.com/store/test/123");
    expect(result).toBe("<html>menu</html>");
  });

  it("retries on 403 and returns HTML on retry success", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue("<html>retry-success</html>"),
      });
    const result = await fetchUberEatsHtml("https://www.ubereats.com/store/test/123");
    expect(result).toBe("<html>retry-success</html>");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns null on 403 when retry also fails", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await fetchUberEatsHtml("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
  });

  it("returns null on non-403 error status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await fetchUberEatsHtml("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await fetchUberEatsHtml("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
  });
});

// ─── scrapeUberEatsViaFirecrawl ─────────────────────────────────────────────

describe("scrapeUberEatsViaFirecrawl", () => {
  it("returns HTML when Firecrawl scrape succeeds", async () => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { html: "<html>menu</html>" } }),
    });
    const result = await scrapeUberEatsViaFirecrawl("https://www.ubereats.com/store/test/123");
    expect(result).toBe("<html>menu</html>");
    delete process.env["FIRECRAWL_API_KEY"];
  });

  it("returns null when API key is missing", async () => {
    delete process.env["FIRECRAWL_API_KEY"];
    const result = await scrapeUberEatsViaFirecrawl("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
  });

  it("returns null when Firecrawl returns error", async () => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await scrapeUberEatsViaFirecrawl("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
    delete process.env["FIRECRAWL_API_KEY"];
  });

  it("returns null on network error", async () => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    mockFetch.mockRejectedValueOnce(new Error("network fail"));
    const result = await scrapeUberEatsViaFirecrawl("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
    delete process.env["FIRECRAWL_API_KEY"];
  });
});

// ─── scrapeUberEatsMarkdown (function) ──────────────────────────────────────

describe("scrapeUberEatsMarkdown (function)", () => {
  it("returns markdown when Firecrawl scrape succeeds", async () => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { markdown: "# Menu\n- Item 1" } }),
    });
    const result = await scrapeUberEatsMarkdown("https://www.ubereats.com/store/test/123");
    expect(result).toBe("# Menu\n- Item 1");
    delete process.env["FIRECRAWL_API_KEY"];
  });

  it("returns null when API key is missing", async () => {
    delete process.env["FIRECRAWL_API_KEY"];
    const result = await scrapeUberEatsMarkdown("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
  });

  it("returns null when Firecrawl returns error", async () => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await scrapeUberEatsMarkdown("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
    delete process.env["FIRECRAWL_API_KEY"];
  });

  it("returns null on network error", async () => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    mockFetch.mockRejectedValueOnce(new Error("network fail"));
    const result = await scrapeUberEatsMarkdown("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
    delete process.env["FIRECRAWL_API_KEY"];
  });
});

// ─── isBotDefensePage ───────────────────────────────────────────────────────

describe("isBotDefensePage", () => {
  it("detects bot defense page", () => {
    const html = '<html><head><link rel="preload" href="https://d3i4yxtzktqr9n.cloudfront.net/botdefense-ext-ui/client-main.js"></head></html>';
    expect(isBotDefensePage(html)).toBe(true);
  });

  it("returns false for normal page", () => {
    const html = fixture("ubereats-thai-place.html");
    expect(isBotDefensePage(html)).toBe(false);
  });
});

// ─── extractMenuViaJsonLd (bot defense detection) ──────────────────────────

describe("extractMenuViaJsonLd", () => {
  it("returns botDefense: true when page has bot defense", async () => {
    const botHtml = '<html><head><link href="botdefense-ext-ui/main.js"></head><body>challenge</body></html>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(botHtml),
    });
    const result = await extractMenuViaJsonLd("https://www.ubereats.com/store/test/123");
    expect(result).not.toBeNull();
    expect(result?.botDefense).toBe(true);
    expect(result?.items).toHaveLength(0);
  });

  it("returns items when page has valid JSON-LD", async () => {
    const html = fixture("ubereats-thai-place.html");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(html),
    });
    const result = await extractMenuViaJsonLd("https://www.ubereats.com/store/test/123");
    expect(result).not.toBeNull();
    expect(result?.botDefense).toBeUndefined();
    expect(result!.items.length).toBeGreaterThan(0);
  });
});

// ─── extractMenuViaFirecrawl ───────────────────────────────────────────────

describe("extractMenuViaFirecrawl", () => {
  it("returns items when Firecrawl HTML has valid JSON-LD", async () => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    const html = fixture("ubereats-thai-place.html");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { html } }),
    });
    const result = await extractMenuViaFirecrawl("https://www.ubereats.com/store/test/123");
    expect(result).not.toBeNull();
    expect(result!.items.length).toBeGreaterThan(0);
    delete process.env["FIRECRAWL_API_KEY"];
  });

  it("returns null when Firecrawl returns no HTML", async () => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: {} }),
    });
    const result = await extractMenuViaFirecrawl("https://www.ubereats.com/store/test/123");
    expect(result).toBeNull();
    delete process.env["FIRECRAWL_API_KEY"];
  });
});

// ─── buildResult geo + name validation (via lookup) ─────────────────────────

describe("UberEatsSource geo/name validation", () => {
  beforeEach(() => {
    process.env["FIRECRAWL_API_KEY"] = "test-key";
  });

  afterEach(() => {
    delete process.env["FIRECRAWL_API_KEY"];
  });

  it("accepts result when geo is within 500m", async () => {
    const geoHtml = fixture("ubereats-thai-place-geo.html");
    const source = new UberEatsSource();
    source.urlCache = new Map([["Thai Orchid", "https://www.ubereats.com/store/thai-orchid/AbCd"]]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValue(geoHtml),
    });

    // Pass geo close to fixture (34.0917, -118.2889) — ~100m away
    const result = await source.lookup("Thai Orchid", "LA", { lat: 34.0920, lng: -118.2885 });
    expect(result.found).toBe(true);
  });

  it("rejects result when geo is >500m away", async () => {
    const geoHtml = fixture("ubereats-thai-place-geo.html");
    const source = new UberEatsSource();
    source.urlCache = new Map([["Thai Orchid", "https://www.ubereats.com/store/thai-orchid/AbCd"]]);

    mockFetch
      // url-cache hit — geo mismatch
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(geoHtml),
      })
      // Brave discovery — no match
      .mockResolvedValueOnce({ ok: false, status: 500 })
      // Firecrawl discovery — no match
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

    // Pass geo far from fixture (34.0917, -118.2889) — ~5km away
    const result = await source.lookup("Thai Orchid", "LA", { lat: 34.1400, lng: -118.2889 });
    expect(result.found).toBe(false);
  });

  it("sets nameMismatch when geo matches but name differs", async () => {
    const geoHtml = fixture("ubereats-thai-place-geo.html");
    const source = new UberEatsSource();
    source.urlCache = new Map([["Orchid Thai Kitchen", "https://www.ubereats.com/store/thai-orchid/AbCd"]]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValue(geoHtml),
    });

    // Geo is close, but name doesn't match
    const result = await source.lookup("Orchid Thai Kitchen", "LA", { lat: 34.0917, lng: -118.2889 });
    expect(result.found).toBe(true);
    expect(result.nameMismatch).toBe(true);
  });

  it("falls back to name matching when no geo available", async () => {
    // Use fixture without geo
    const noGeoHtml = fixture("ubereats-thai-place.html");
    const source = new UberEatsSource();
    source.urlCache = new Map([["Thai Orchid", "https://www.ubereats.com/store/thai-orchid/AbCd"]]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValue(noGeoHtml),
    });

    const result = await source.lookup("Thai Orchid", "LA", { lat: 34.0917, lng: -118.2889 });
    expect(result.found).toBe(true);
  });

  it("rejects on name mismatch when no geo and words don't match", async () => {
    const noGeoHtml = fixture("ubereats-thai-place.html");
    const source = new UberEatsSource();
    source.urlCache = new Map([["Totally Different Place", "https://www.ubereats.com/store/thai-orchid/AbCd"]]);

    mockFetch
      // url-cache hit — name mismatch
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(noGeoHtml),
      })
      // Brave discovery — no match
      .mockResolvedValueOnce({ ok: false, status: 500 })
      // Firecrawl discovery — no match
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

    const result = await source.lookup("Totally Different Place", "LA");
    expect(result.found).toBe(false);
  });
});

// ─── UberEatsSource API mode tests ──────────────────────────────────────────

describe("UberEatsSource API modes", () => {
  afterEach(() => {
    delete process.env["FIRECRAWL_API_KEY"];
    delete process.env["UE_API_MODE"];
  });

  it("uses shadow mode when UE_API_MODE=shadow", async () => {
    process.env["UE_API_MODE"] = "shadow";
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    const geoHtml = fixture("ubereats-thai-place-geo.html");
    const source = new UberEatsSource();
    source.urlCache = new Map([["Thai Orchid", "https://www.ubereats.com/store/thai-orchid/AbCd1234-5678-9012-3456"]]);

    mockFetch
      // JSON-LD raw fetch
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(geoHtml),
      })
      // API call (parallel) — return ok false (404)
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await source.lookup("Thai Orchid", "LA", { lat: 34.0917, lng: -118.2889 });
    // Shadow mode: JSON-LD is authoritative, should still return found
    expect(result.found).toBe(true);
  });
});

// ─── UberEatsSource.lookup with bot defense fallback ───────────────────────

describe("UberEatsSource bot defense fallback", () => {
  it("falls back to Firecrawl when raw fetch hits bot defense", async () => {
    const botHtml = '<html><head><link href="botdefense-ext-ui/main.js"></head></html>';
    const jsonLdHtml = fixture("ubereats-thai-place.html");
    const sourceWithCache = new UberEatsSource();
    sourceWithCache.urlCache = new Map([["Thai Orchid", "https://www.ubereats.com/store/thai-orchid/AbCd"]]);
    process.env["FIRECRAWL_API_KEY"] = "test-key";
    delete process.env["BRAVE_SEARCH_API_KEY"];

    mockFetch
      // Step 2: url-cache raw fetch → bot defense page
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(botHtml),
      })
      // Step 5: Firecrawl URL discovery (discoverUberEatsUrl) — no UE URL
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      })
      // Step 6: Firecrawl HTML fallback (scrapeUberEatsViaFirecrawl) → success
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: { html: jsonLdHtml } }),
      });

    const result = await sourceWithCache.lookup("Thai Orchid", "LA");
    expect(result.found).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    delete process.env["FIRECRAWL_API_KEY"];
  });
});
