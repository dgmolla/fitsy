// ─── Mock fetch before importing client ─────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import {
  decodeStoreUuid,
  fetchStoreV1,
  parseStoreV1Response,
  extractMenuViaApi,
} from "./ueApiClient";

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── decodeStoreUuid ─────────────────────────────────────────────────────────

describe("decodeStoreUuid", () => {
  it("decodes the 22-char base64url segment to a canonical UUID", () => {
    // UpD92M0RROiy3kC-gabg0w → 5290fdd8-cd11-44e8-b2de-40be81a6e0d3 (Alcove, verified live)
    const uuid = decodeStoreUuid(
      "https://www.ubereats.com/store/alcove-coffeehouse/UpD92M0RROiy3kC-gabg0w",
    );
    expect(uuid).toBe("5290fdd8-cd11-44e8-b2de-40be81a6e0d3");
  });

  it("handles trailing query string", () => {
    const uuid = decodeStoreUuid(
      "https://www.ubereats.com/store/alcove-coffeehouse/UpD92M0RROiy3kC-gabg0w?srsltid=abc",
    );
    expect(uuid).toBe("5290fdd8-cd11-44e8-b2de-40be81a6e0d3");
  });

  it("handles trailing slash", () => {
    const uuid = decodeStoreUuid(
      "https://www.ubereats.com/store/alcove-coffeehouse/UpD92M0RROiy3kC-gabg0w/",
    );
    expect(uuid).toBe("5290fdd8-cd11-44e8-b2de-40be81a6e0d3");
  });

  it("returns null for slug-only URLs (no UUID segment)", () => {
    expect(decodeStoreUuid("https://www.ubereats.com/store/alcove")).toBeNull();
  });

  it("returns null for unrelated URLs", () => {
    expect(decodeStoreUuid("https://www.example.com/foo/bar")).toBeNull();
  });

  it("returns null when the segment is too short or too long", () => {
    expect(
      decodeStoreUuid("https://www.ubereats.com/store/x/TOOSHORT"),
    ).toBeNull();
    expect(
      decodeStoreUuid(
        "https://www.ubereats.com/store/x/WAYTOOLONGSEGMENTAAAAAAAAAA",
      ),
    ).toBeNull();
  });
});

// ─── fetchStoreV1 ────────────────────────────────────────────────────────────

describe("fetchStoreV1", () => {
  it("POSTs storeUuid as JSON and returns parsed response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success", data: { title: "Test" } }),
    });

    const result = await fetchStoreV1("5290fdd8-cd11-44e8-b2de-40be81a6e0d3");
    expect(result).toEqual({ status: "success", data: { title: "Test" } });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.ubereats.com/_p/api/getStoreV1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      storeUuid: "5290fdd8-cd11-44e8-b2de-40be81a6e0d3",
    });
  });

  it("returns null on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await fetchStoreV1("5290fdd8-cd11-44e8-b2de-40be81a6e0d3");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    const result = await fetchStoreV1("5290fdd8-cd11-44e8-b2de-40be81a6e0d3");
    expect(result).toBeNull();
  });

  it("returns null when the request aborts via timeout", async () => {
    mockFetch.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const result = await fetchStoreV1("x", { timeoutMs: 10 });
    expect(result).toBeNull();
  });
});

// ─── parseStoreV1Response ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildResponse(sections: Array<{ name?: string; items: Array<{ title: string; description?: string; price?: number; uuid?: string }> }>): any {
  return {
    status: "success",
    data: {
      title: "Alcove Coffeehouse",
      location: { latitude: 34.1, longitude: -118.3 },
      heroImageUrls: [{ url: "https://cdn.ubereats.com/hero.jpg" }],
      catalogSectionsMap: {
        "storefront-uuid": sections.map((section) => ({
          payload: {
            standardItemsPayload: {
              ...(section.name ? { title: { text: section.name } } : {}),
              catalogItems: section.items.map((item) => ({
                uuid: item.uuid ?? "item-uuid",
                title: item.title,
                ...(item.description !== undefined ? { itemDescription: item.description } : {}),
                ...(item.price !== undefined ? { price: item.price } : {}),
                isAvailable: true,
              })),
            },
          },
        })),
      },
    },
  };
}

describe("parseStoreV1Response", () => {
  it("extracts items, names, descriptions, prices, sections", () => {
    const json = buildResponse([
      {
        name: "Sandwiches",
        items: [
          { title: "BLT", description: "Bacon lettuce tomato", price: 1250 },
          { title: "Reuben", price: 1450 },
        ],
      },
    ]);

    const result = parseStoreV1Response(json)!;
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      name: "BLT",
      description: "Bacon lettuce tomato",
      price: 12.5,
      section: "Sandwiches",
    });
    expect(result.items[1]).toEqual({
      name: "Reuben",
      price: 14.5,
      section: "Sandwiches",
    });
  });

  it("returns restaurant metadata (name, imageUrl, geo)", () => {
    const json = buildResponse([{ items: [{ title: "Coffee", price: 500 }] }]);
    const result = parseStoreV1Response(json)!;
    expect(result.restaurant.name).toBe("Alcove Coffeehouse");
    expect(result.restaurant.imageUrl).toBe("https://cdn.ubereats.com/hero.jpg");
    expect(result.geo).toEqual({ lat: 34.1, lng: -118.3 });
  });

  it("dedupes items that appear in both Most Popular and a main section", () => {
    const json = buildResponse([
      { name: "Most Popular", items: [{ title: "BLT", price: 1250 }] },
      { name: "Sandwiches", items: [{ title: "BLT", price: 1250 }] },
    ]);
    const result = parseStoreV1Response(json)!;
    expect(result.items).toHaveLength(1);
    // Should keep the first occurrence's section (Most Popular)
    expect(result.items[0]!.section).toBe("Most Popular");
  });

  it("upgrades section name when first occurrence had no section", () => {
    const json = buildResponse([
      { items: [{ title: "BLT", price: 1250 }] },
      { name: "Sandwiches", items: [{ title: "BLT", price: 1250 }] },
    ]);
    const result = parseStoreV1Response(json)!;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.section).toBe("Sandwiches");
  });

  it("dedupes case-insensitively", () => {
    const json = buildResponse([
      { items: [{ title: "BLT" }] },
      { items: [{ title: "blt" }] },
    ]);
    const result = parseStoreV1Response(json)!;
    expect(result.items).toHaveLength(1);
  });

  it("skips items with empty titles", () => {
    const json = buildResponse([
      { items: [{ title: "   " }, { title: "Valid", price: 500 }] },
    ]);
    const result = parseStoreV1Response(json)!;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.name).toBe("Valid");
  });

  it("omits price when zero or missing", () => {
    const json = buildResponse([
      { items: [{ title: "Free Item", price: 0 }, { title: "No Price" }] },
    ]);
    const result = parseStoreV1Response(json)!;
    expect(result.items[0]!.price).toBeUndefined();
    expect(result.items[1]!.price).toBeUndefined();
  });

  it("returns null when no catalogSectionsMap", () => {
    const result = parseStoreV1Response({ data: { title: "x" } });
    expect(result).toBeNull();
  });

  it("returns null when all sections are empty", () => {
    const json = buildResponse([{ items: [] }]);
    expect(parseStoreV1Response(json)).toBeNull();
  });

  it("returns null when data is absent", () => {
    expect(parseStoreV1Response({})).toBeNull();
  });
});

// ─── extractMenuViaApi ───────────────────────────────────────────────────────

describe("extractMenuViaApi", () => {
  it("returns null for URLs without a decodable UUID", async () => {
    const result = await extractMenuViaApi("https://www.example.com");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("full happy path: decode → fetch → parse", async () => {
    const json = buildResponse([
      { name: "Drinks", items: [{ title: "Latte", price: 550 }] },
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => json });

    const result = await extractMenuViaApi(
      "https://www.ubereats.com/store/alcove/UpD92M0RROiy3kC-gabg0w",
    );
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0]!.name).toBe("Latte");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      storeUuid: "5290fdd8-cd11-44e8-b2de-40be81a6e0d3",
    });
  });

  it("returns null when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const result = await extractMenuViaApi(
      "https://www.ubereats.com/store/alcove/UpD92M0RROiy3kC-gabg0w",
    );
    expect(result).toBeNull();
  });
});
