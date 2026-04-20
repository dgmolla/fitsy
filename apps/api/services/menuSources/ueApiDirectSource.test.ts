// ─── Mock fetch before importing source ─────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { UeApiDirectSource } from "./ueApiDirectSource";
import { UeUnexpectedError } from "./ueApiClient";

const STORE_UUID = "db1c9d53-e420-599f-b903-fb3102e6bb9e";

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("UeApiDirectSource.lookup — failure-mode discrimination", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns a populated result when UE responds with items", async () => {
    mockFetch.mockResolvedValue(
      okJson({
        status: "success",
        data: {
          title: "Alcove",
          catalogSectionsMap: {
            s1: [
              {
                payload: {
                  standardItemsPayload: {
                    title: { text: "Mains" },
                    catalogItems: [{ title: "BLT", price: 1200 }],
                  },
                },
              },
            ],
          },
        },
      }),
    );

    const result = await new UeApiDirectSource(STORE_UUID, { baseBackoffMs: 0 }).lookup("Alcove", "");
    expect(result.found).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.name).toBe("BLT");
  });

  it("soft-skips (found: false) when UE returns data with no catalogSectionsMap", async () => {
    mockFetch.mockResolvedValue(okJson({ status: "success", data: { title: "Ghost kitchen" } }));

    const result = await new UeApiDirectSource(STORE_UUID, { baseBackoffMs: 0 }).lookup("x", "");
    expect(result.found).toBe(false);
    expect(result.sourceId).toBe("ue_api_direct");
  });

  it("soft-skips when every section carries emptyStatePayload (closed store)", async () => {
    mockFetch.mockResolvedValue(
      okJson({
        status: "success",
        data: {
          title: "Closed for the day",
          catalogSectionsMap: {
            s1: [{ payload: { emptyStatePayload: {}, type: "EMPTY_STATE" } }],
          },
        },
      }),
    );

    const result = await new UeApiDirectSource(STORE_UUID, { baseBackoffMs: 0 }).lookup("x", "");
    expect(result.found).toBe(false);
    expect(result.sourceId).toBe("ue_api_direct");
  });

  it("throws UeUnexpectedError when fetch exhausts retries", async () => {
    mockFetch.mockResolvedValue(new Response("blocked", { status: 403 }));

    await expect(
      new UeApiDirectSource(STORE_UUID, { baseBackoffMs: 0, maxRetries: 0 }).lookup("x", ""),
    ).rejects.toBeInstanceOf(UeUnexpectedError);
  });

  it("throws UeUnexpectedError when the response has no `data` block", async () => {
    mockFetch.mockResolvedValue(okJson({ status: "success" }));

    await expect(
      new UeApiDirectSource(STORE_UUID, { baseBackoffMs: 0 }).lookup("x", ""),
    ).rejects.toThrow(/no_data/);
  });

  it("throws UeUnexpectedError when sections exist but every item gets filtered", async () => {
    mockFetch.mockResolvedValue(
      okJson({
        status: "success",
        data: {
          title: "Schema drift",
          catalogSectionsMap: {
            s1: [
              {
                payload: {
                  standardItemsPayload: {
                    title: { text: "Mains" },
                    // All items missing `title` — simulates schema drift
                    catalogItems: [{ price: 1200 }, { price: 1500 }],
                  },
                },
              },
            ],
          },
        },
      }),
    );

    await expect(
      new UeApiDirectSource(STORE_UUID, { baseBackoffMs: 0 }).lookup("x", ""),
    ).rejects.toThrow(/no_items_parsed/);
  });
});
