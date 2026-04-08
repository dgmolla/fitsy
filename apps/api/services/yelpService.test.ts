// ─── Mock global fetch before importing ───────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { searchYelpBusiness } from "./yelpService";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockFetch.mockReset();
  process.env = { ...ORIGINAL_ENV, YELP_API_KEY: "yelp_test_key" };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ─── searchYelpBusiness ───────────────────────────────────────────────────────

describe("searchYelpBusiness", () => {
  it("returns image_url when Yelp returns a matching business", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        businesses: [{ image_url: "https://s3-media1.fl.yelpcdn.com/bphoto/abc.jpg" }],
      }),
    });

    const url = await searchYelpBusiness("Nobu", "903 N La Cienega Blvd, Los Angeles");

    expect(url).toBe("https://s3-media1.fl.yelpcdn.com/bphoto/abc.jpg");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain("https://api.yelp.com/v3/businesses/search");
    expect(calledUrl).toContain("term=Nobu");
    expect(options.headers["Authorization"]).toBe("Bearer yelp_test_key");
  });

  it("returns null when businesses array is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ businesses: [] }),
    });

    const url = await searchYelpBusiness("Ghost Restaurant", "123 Nowhere St");
    expect(url).toBeNull();
  });

  it("returns null when business has no image_url", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        businesses: [{ name: "Some Place" }],
      }),
    });

    const url = await searchYelpBusiness("Some Place", "456 Main St");
    expect(url).toBeNull();
  });

  it("returns null when YELP_API_KEY is absent", async () => {
    delete process.env["YELP_API_KEY"];

    const url = await searchYelpBusiness("Nobu", "Los Angeles");
    expect(url).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when Yelp API returns non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    const url = await searchYelpBusiness("Nobu", "Los Angeles");
    expect(url).toBeNull();
  });

  it("returns null when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const url = await searchYelpBusiness("Nobu", "Los Angeles");
    expect(url).toBeNull();
  });
});
