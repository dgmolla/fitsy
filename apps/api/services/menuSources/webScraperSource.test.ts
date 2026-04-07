import type { WebScraper } from "../scrapers/types";
import { WebScraperSource } from "./webScraperSource";

// ─── Mock Anthropic ──────────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

import Anthropic from "@anthropic-ai/sdk";

// ─── Mock WebScraper ─────────────────────────────────────────────────────────

function createMockScraper(overrides?: Partial<WebScraper>): WebScraper {
  return {
    id: "mock-scraper",
    scrape: jest.fn().mockResolvedValue(null),
    search: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ─── Test helpers ────────────────────────────────────────────────────────────

const SAMPLE_MARKDOWN = `# Thai Orchid Menu

## Appetizers
- Spring Rolls - $8.00
- Satay Chicken - $10.00

## Entrees
- Pad Thai - $18.00 - Stir-fried rice noodles with shrimp
- Green Curry - $16.00 - Thai green curry with vegetables
This is long enough to pass the minimum content length check for the scraper source.`;

const HAIKU_RESPONSE = JSON.stringify([
  { name: "Spring Rolls", category: "Appetizer", section: "Appetizers" },
  { name: "Satay Chicken", category: "Appetizer", section: "Appetizers" },
  { name: "Pad Thai", description: "Stir-fried rice noodles with shrimp", category: "Entree", section: "Entrees" },
  { name: "Green Curry", description: "Thai green curry with vegetables", category: "Entree", section: "Entrees" },
]);

beforeEach(() => {
  mockCreate.mockReset();
});

describe("WebScraperSource", () => {
  it("has the same id as the scraper", () => {
    const scraper = createMockScraper();
    const source = new WebScraperSource(scraper, new Anthropic());
    expect(source.id).toBe("mock-scraper");
  });

  describe("lookup", () => {
    it("uses scraper.search() and Haiku to extract items", async () => {
      const scraper = createMockScraper({
        search: jest.fn().mockResolvedValue(SAMPLE_MARKDOWN),
      });

      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: HAIKU_RESPONSE }],
      });

      const source = new WebScraperSource(scraper, new Anthropic());
      const result = await source.lookup("Thai Orchid", "LA");

      expect(result.found).toBe(true);
      expect(result.items).toHaveLength(4);
      expect(result.items[0]?.name).toBe("Spring Rolls");
      expect(result.items[2]?.description).toContain("rice noodles");
      expect(scraper.search).toHaveBeenCalledWith("Thai Orchid menu");
    });

    it("returns found: false when search returns null", async () => {
      const scraper = createMockScraper({
        search: jest.fn().mockResolvedValue(null),
      });

      const source = new WebScraperSource(scraper, new Anthropic());
      const result = await source.lookup("Unknown", "LA");

      expect(result.found).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it("returns found: false when Haiku returns empty array", async () => {
      const scraper = createMockScraper({
        search: jest.fn().mockResolvedValue(SAMPLE_MARKDOWN),
      });

      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "[]" }],
      });

      const source = new WebScraperSource(scraper, new Anthropic());
      const result = await source.lookup("Thai Orchid", "LA");

      expect(result.found).toBe(false);
    });

    it("returns found: false when Haiku call fails", async () => {
      const scraper = createMockScraper({
        search: jest.fn().mockResolvedValue(SAMPLE_MARKDOWN),
      });

      mockCreate.mockRejectedValue(new Error("API error"));

      const source = new WebScraperSource(scraper, new Anthropic());
      const result = await source.lookup("Thai Orchid", "LA");

      expect(result.found).toBe(false);
    });
  });

  describe("lookupByUrl", () => {
    it("uses scraper.scrape() for direct URL", async () => {
      const scraper = createMockScraper({
        scrape: jest.fn().mockResolvedValue(SAMPLE_MARKDOWN),
      });

      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: HAIKU_RESPONSE }],
      });

      const source = new WebScraperSource(scraper, new Anthropic());
      const result = await source.lookupByUrl("Thai Orchid", "https://thaiorchid.com/menu");

      expect(result.found).toBe(true);
      expect(result.items).toHaveLength(4);
      expect(result.restaurant?.name).toBe("Thai Orchid");
      expect(scraper.scrape).toHaveBeenCalledWith("https://thaiorchid.com/menu");
    });

    it("returns found: false when scrape returns null", async () => {
      const scraper = createMockScraper({
        scrape: jest.fn().mockResolvedValue(null),
      });

      const source = new WebScraperSource(scraper, new Anthropic());
      const result = await source.lookupByUrl("Thai Orchid", "https://thaiorchid.com");

      expect(result.found).toBe(false);
    });
  });

  describe("Haiku response parsing", () => {
    it("strips markdown fences from Haiku response", async () => {
      const scraper = createMockScraper({
        search: jest.fn().mockResolvedValue(SAMPLE_MARKDOWN),
      });

      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "```json\n" + HAIKU_RESPONSE + "\n```" }],
      });

      const source = new WebScraperSource(scraper, new Anthropic());
      const result = await source.lookup("Thai Orchid", "LA");

      expect(result.found).toBe(true);
      expect(result.items).toHaveLength(4);
    });

    it("skips items with empty or non-string names", async () => {
      const scraper = createMockScraper({
        search: jest.fn().mockResolvedValue(SAMPLE_MARKDOWN),
      });

      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify([
          { name: "Valid Item" },
          { name: "" },
          { name: 123 },
          { description: "No name field" },
        ]) }],
      });

      const source = new WebScraperSource(scraper, new Anthropic());
      const result = await source.lookup("Test", "LA");

      expect(result.found).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.name).toBe("Valid Item");
    });
  });
});
