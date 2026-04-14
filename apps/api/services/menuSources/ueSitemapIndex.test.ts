import { UESitemapIndex } from "./ueSitemapIndex";

// Mock fs and fetch
jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Small XML fixture with store URLs
const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.ubereats.com/store/thai-orchid/abc-123</loc></url>
  <url><loc>https://www.ubereats.com/store/panda-express-la/def-456</loc></url>
  <url><loc>https://www.ubereats.com/store/joes-pizza-brooklyn/ghi-789</loc></url>
  <url><loc>https://www.ubereats.com/category/los-angeles</loc></url>
</urlset>`;

beforeEach(() => {
  mockFetch.mockReset();
  jest.clearAllMocks();
});

describe("UESitemapIndex", () => {
  it("extracts store URLs from XML and builds slug index", async () => {
    // Mock all 26 shard fetches — first returns data, rest return 404
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("-000.xml")) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(SITEMAP_XML),
        };
      }
      return { ok: false, status: 404 };
    });

    const index = new UESitemapIndex();
    await index.load();

    // Should have indexed 3 store URLs (not the category URL)
    expect(index.size).toBe(3);
  });

  it("findUrl returns exact slug match", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("-000.xml")) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(SITEMAP_XML),
        };
      }
      return { ok: false, status: 404 };
    });

    const index = new UESitemapIndex();
    await index.load();

    const url = index.findUrl("Thai Orchid");
    expect(url).toBe("https://www.ubereats.com/store/thai-orchid/abc-123");
  });

  it("findUrl returns null for substring match — exact slug only", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("-000.xml")) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(SITEMAP_XML),
        };
      }
      return { ok: false, status: 404 };
    });

    const index = new UESitemapIndex();
    await index.load();

    // "Panda Express" normalizes to "panda-express" but index has "panda-express-la" — no substring match
    const url = index.findUrl("Panda Express");
    expect(url).toBeNull();
  });

  it("findUrl returns null when no match found", async () => {
    mockFetch.mockImplementation(async () => ({ ok: false, status: 404 }));

    const index = new UESitemapIndex();
    await index.load();

    const url = index.findUrl("Nonexistent Restaurant");
    expect(url).toBeNull();
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const index = new UESitemapIndex();
    await index.load();

    expect(index.size).toBe(0);
  });

  it("does not re-download if already loaded", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("-000.xml")) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(SITEMAP_XML),
        };
      }
      return { ok: false, status: 404 };
    });

    const index = new UESitemapIndex();
    await index.load();
    const callCount = mockFetch.mock.calls.length;

    await index.load(); // second call should be no-op
    expect(mockFetch.mock.calls.length).toBe(callCount);
  });
});
