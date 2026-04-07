// ─── Mock fetch before importing ─────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { JinaScraper } from "./jinaScraper";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("JinaScraper", () => {
  // Use a short delay for tests by manipulating internal state
  let scraper: JinaScraper;

  beforeEach(() => {
    scraper = new JinaScraper();
    // Reset lastCallTime to avoid rate limit delays in tests
    (scraper as unknown as { lastCallTime: number }).lastCallTime = 0;
  });

  describe("scrape", () => {
    it("fetches from r.jina.ai/{url} with correct headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue("# Menu\n\n- Pad Thai $18\n- Green Curry $16\n\nA long enough response to pass the minimum content length check."),
      });

      const result = await scraper.scrape("https://example.com/menu");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://r.jina.ai/https://example.com/menu",
        { headers: { Accept: "text/plain", "X-No-Cache": "true" } },
      );
      expect(result).toContain("Pad Thai");
    });

    it("returns null on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await scraper.scrape("https://example.com");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await scraper.scrape("https://example.com");
      expect(result).toBeNull();
    });

    it("returns null when content is too short", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue("short"),
      });

      const result = await scraper.scrape("https://example.com");
      expect(result).toBeNull();
    });
  });

  describe("search", () => {
    it("fetches from s.jina.ai/{encoded query}", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue("# Search Results\n\n1. Thai Orchid Menu\n- Pad Thai $18\n\nLong enough content to pass the minimum length check for search results."),
      });

      const result = await scraper.search("Thai Orchid menu Los Angeles");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://s.jina.ai/Thai%20Orchid%20menu%20Los%20Angeles",
        { headers: { Accept: "text/plain", "X-No-Cache": "true" } },
      );
      expect(result).toContain("Thai Orchid");
    });

    it("returns null on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await scraper.search("test query");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await scraper.search("test query");
      expect(result).toBeNull();
    });
  });

  it("has id 'jina'", () => {
    expect(scraper.id).toBe("jina");
  });
});
