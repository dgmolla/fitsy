const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { BraveSearchScraper, discoverUberEatsUrlViaBrave } from "./braveSearchScraper";

beforeEach(() => {
  mockFetch.mockReset();
  process.env["BRAVE_SEARCH_API_KEY"] = "test-key";
});

afterEach(() => {
  delete process.env["BRAVE_SEARCH_API_KEY"];
});

describe("discoverUberEatsUrlViaBrave", () => {
  it("returns UE store URL when found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { url: "https://www.ubereats.com/store/sqirl/abc123", title: "Sqirl" },
          ],
        },
      }),
    });

    const url = await discoverUberEatsUrlViaBrave("Sqirl", "720 N Virgil Ave, Los Angeles, CA");
    expect(url).toBe("https://www.ubereats.com/store/sqirl/abc123");
  });

  it("returns null when no UE URLs found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: { results: [{ url: "https://sqirl.com", title: "Sqirl" }] },
      }),
    });

    const url = await discoverUberEatsUrlViaBrave("Sqirl", "720 N Virgil Ave, Los Angeles, CA");
    expect(url).toBeNull();
  });

  it("returns null when API key is missing", async () => {
    delete process.env["BRAVE_SEARCH_API_KEY"];
    const url = await discoverUberEatsUrlViaBrave("Sqirl", "720 N Virgil Ave, Los Angeles, CA");
    expect(url).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    const url = await discoverUberEatsUrlViaBrave("Sqirl", "720 N Virgil Ave, Los Angeles, CA");
    expect(url).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const url = await discoverUberEatsUrlViaBrave("Sqirl", "720 N Virgil Ave, Los Angeles, CA");
    expect(url).toBeNull();
  });

  it("skips slug-only UE URLs (no UUID)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { url: "https://www.ubereats.com/store/sqirl", title: "Sqirl" },
          ],
        },
      }),
    });

    const url = await discoverUberEatsUrlViaBrave("Sqirl", "720 N Virgil Ave, Los Angeles, CA");
    expect(url).toBeNull();
  });
});

describe("BraveSearchScraper", () => {
  let scraper: BraveSearchScraper;

  beforeEach(() => {
    scraper = new BraveSearchScraper();
  });

  describe("search", () => {
    it("returns combined markdown from results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [
              { title: "Sqirl Menu", description: "Brunch items: Ricotta Toast, Grain Bowl" },
              { title: "Sqirl LA", description: "Known for seasonal jam and rice bowls" },
            ],
          },
        }),
      });

      const result = await scraper.search("Sqirl menu");
      expect(result).toContain("Sqirl Menu");
      expect(result).toContain("Ricotta Toast");
    });

    it("returns null when no results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ web: { results: [] } }),
      });

      const result = await scraper.search("nonexistent restaurant");
      expect(result).toBeNull();
    });

    it("returns null when API key is missing", async () => {
      delete process.env["BRAVE_SEARCH_API_KEY"];
      const result = await scraper.search("test");
      expect(result).toBeNull();
    });

    it("returns null on API error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await scraper.search("test");
      expect(result).toBeNull();
    });
  });

  describe("scrape", () => {
    it("returns null (not supported by Brave Search)", async () => {
      const result = await scraper.scrape("https://example.com");
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
