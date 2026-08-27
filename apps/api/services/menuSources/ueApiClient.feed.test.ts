import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildFeedCookieHeader,
  parseFeedV1Response,
} from "./ueApiClient";

// Cached response from `npx tsx scripts/ue-feed-spike.ts` — 67 REGULAR_STORE
// entries centered on Los Feliz. Kept in-repo so the parser has a fixture that
// reflects the live UE shape without hitting the network.
const SAMPLE_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "cache",
  "ue-feed-spike-sample.json",
);

interface SpikeSample {
  feedRaw: unknown;
}

function loadSample() {
  const raw = readFileSync(SAMPLE_PATH, "utf-8");
  const sample = JSON.parse(raw) as SpikeSample;
  return sample.feedRaw;
}

describe("parseFeedV1Response", () => {
  it("extracts normalized cards from every REGULAR_STORE in the live feed sample", () => {
    const json = loadSample() as Parameters<typeof parseFeedV1Response>[0];
    const cards = parseFeedV1Response(json);

    expect(cards.length).toBeGreaterThan(20);

    for (const card of cards) {
      expect(card.storeUuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.lat).toBeGreaterThan(-90);
      expect(card.lat).toBeLessThan(90);
      expect(card.lng).toBeGreaterThan(-180);
      expect(card.lng).toBeLessThan(180);
    }

    const withRating = cards.filter((c) => c.rating !== undefined);
    expect(withRating.length).toBeGreaterThan(0);
    for (const c of withRating) {
      expect(c.rating).toBeGreaterThanOrEqual(0);
      expect(c.rating).toBeLessThanOrEqual(5);
    }

    const withPhoto = cards.filter((c) => c.photoUrl);
    expect(withPhoto.length).toBeGreaterThan(0);
    for (const c of withPhoto) {
      expect(c.photoUrl).toMatch(/^https:\/\/tb-static\.uber\.com\//);
    }

    const withSlug = cards.filter((c) => c.slug);
    expect(withSlug.length).toBeGreaterThan(0);
  });

  it("returns an empty array for a response missing feedItems", () => {
    expect(parseFeedV1Response({} as Parameters<typeof parseFeedV1Response>[0])).toEqual([]);
    expect(
      parseFeedV1Response({ status: "success", data: {} } as Parameters<typeof parseFeedV1Response>[0]),
    ).toEqual([]);
  });

  it("skips feed items that are not REGULAR_STORE", () => {
    const json = {
      status: "success",
      data: {
        feedItems: [
          { type: "SECTION_HEADER", uuid: "x" },
          { type: "DIVIDER", uuid: "y" },
          {
            type: "REGULAR_STORE",
            uuid: "a",
            store: {
              storeUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              title: { text: "Test Store" },
              mapMarker: { latitude: 34.1, longitude: -118.3 },
            },
          },
        ],
      },
    };
    const cards = parseFeedV1Response(
      json as Parameters<typeof parseFeedV1Response>[0],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.name).toBe("Test Store");
  });

  it("skips stores missing required fields (uuid, name, or mapMarker)", () => {
    const json = {
      status: "success",
      data: {
        feedItems: [
          { type: "REGULAR_STORE", store: { title: { text: "No UUID" }, mapMarker: { latitude: 1, longitude: 2 } } },
          { type: "REGULAR_STORE", store: { storeUuid: "x", mapMarker: { latitude: 1, longitude: 2 } } },
          { type: "REGULAR_STORE", store: { storeUuid: "x", title: { text: "No Map" } } },
        ],
      },
    };
    expect(
      parseFeedV1Response(json as Parameters<typeof parseFeedV1Response>[0]),
    ).toEqual([]);
  });

  it("extracts stores from REGULAR_CAROUSEL items (e.g. chains like Chick-fil-A)", () => {
    const json = {
      status: "success",
      data: {
        feedItems: [
          {
            type: "REGULAR_STORE",
            store: {
              storeUuid: "11111111-1111-1111-1111-111111111111",
              title: { text: "Local Diner" },
              mapMarker: { latitude: 34.05, longitude: -118.25 },
            },
          },
          {
            type: "REGULAR_CAROUSEL",
            uuid: "carousel-1",
            carousel: {
              header: { title: { text: "National brands" } },
              stores: [
                {
                  storeUuid: "22222222-2222-2222-2222-222222222222",
                  title: { text: "Chick-fil-A" },
                  mapMarker: { latitude: 34.0578, longitude: -118.4185 },
                  actionUrl: "/store/chick-fil-a-x/abc",
                },
                {
                  storeUuid: "33333333-3333-3333-3333-333333333333",
                  title: { text: "In-N-Out Burger" },
                  mapMarker: { latitude: 34.06, longitude: -118.42 },
                },
              ],
            },
          },
        ],
      },
    };
    const cards = parseFeedV1Response(
      json as Parameters<typeof parseFeedV1Response>[0],
    );
    const names = cards.map((c) => c.name);
    expect(names).toContain("Local Diner");
    expect(names).toContain("Chick-fil-A");
    expect(names).toContain("In-N-Out Burger");
  });

  it("dedupes a store that appears both as a REGULAR_STORE and inside a carousel", () => {
    const dupUuid = "44444444-4444-4444-4444-444444444444";
    const json = {
      status: "success",
      data: {
        feedItems: [
          {
            type: "REGULAR_STORE",
            store: {
              storeUuid: dupUuid,
              title: { text: "Chick-fil-A" },
              mapMarker: { latitude: 34.0578, longitude: -118.4185 },
            },
          },
          {
            type: "REGULAR_CAROUSEL",
            carousel: {
              stores: [
                {
                  storeUuid: dupUuid,
                  title: { text: "Chick-fil-A" },
                  mapMarker: { latitude: 34.0578, longitude: -118.4185 },
                },
              ],
            },
          },
        ],
      },
    };
    const cards = parseFeedV1Response(
      json as Parameters<typeof parseFeedV1Response>[0],
    );
    expect(cards.filter((c) => c.storeUuid === dupUuid)).toHaveLength(1);
  });

  it("skips carousel stores missing required fields", () => {
    const json = {
      status: "success",
      data: {
        feedItems: [
          {
            type: "REGULAR_CAROUSEL",
            carousel: {
              stores: [
                { title: { text: "No UUID" }, mapMarker: { latitude: 1, longitude: 2 } },
                { storeUuid: "u", mapMarker: { latitude: 1, longitude: 2 } },
                { storeUuid: "u2", title: { text: "No Map" } },
              ],
            },
          },
          { type: "REGULAR_CAROUSEL" },
        ],
      },
    };
    expect(
      parseFeedV1Response(json as Parameters<typeof parseFeedV1Response>[0]),
    ).toEqual([]);
  });

  it("parses review count from accessibilityText", () => {
    const json = {
      status: "success",
      data: {
        feedItems: [
          {
            type: "REGULAR_STORE",
            store: {
              storeUuid: "u",
              title: { text: "Reviewed" },
              mapMarker: { latitude: 34, longitude: -118 },
              rating: {
                text: "4.8",
                accessibilityText:
                  "A top rated restaurant with 4.8 out of 5 stars based on more than 1,230 reviews.",
              },
            },
          },
        ],
      },
    };
    const [card] = parseFeedV1Response(
      json as Parameters<typeof parseFeedV1Response>[0],
    );
    expect(card!.rating).toBe(4.8);
    expect(card!.userRatingCount).toBe(1230);
  });
});

describe("buildFeedCookieHeader", () => {
  const ORIG = process.env.UE_LOC_COOKIE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.UE_LOC_COOKIE;
    else process.env.UE_LOC_COOKIE = ORIG;
  });

  it("overrides latitude and longitude and scrubs personal cookie fields", () => {
    const original = {
      address: {
        address1: "123 Private St",
        eaterFormattedAddress: "123 Private St, Los Angeles, CA 90012",
        title: "Home",
        uuid: "user-uuid-123",
      },
      latitude: 34.09142,
      longitude: -118.29402,
      reference: "here:af:streetsection:abc",
      referenceType: "here_places",
    };
    process.env.UE_LOC_COOKIE = encodeURIComponent(JSON.stringify(original));

    const header = buildFeedCookieHeader(40.7580, -73.9855);
    expect(header.startsWith("uev2.loc=")).toBe(true);
    const decoded = JSON.parse(decodeURIComponent(header.slice("uev2.loc=".length))) as Record<string, unknown>;
    expect(decoded.latitude).toBe(40.7580);
    expect(decoded.longitude).toBe(-73.9855);
    // Personal fields scrubbed (privacy): original capturer's address must not leak.
    expect(decoded.reference).toBe("");
    const addr = decoded.address as Record<string, string>;
    expect(addr.address1).toBe("");
    expect(addr.eaterFormattedAddress).toBe("");
    expect(addr.title).toBe("");
    expect(addr.uuid).toBe("");
  });

  it("throws a descriptive error when UE_LOC_COOKIE is not set", () => {
    delete process.env.UE_LOC_COOKIE;
    expect(() => buildFeedCookieHeader(0, 0)).toThrow(/UE_LOC_COOKIE/);
  });

  it("throws when the cookie cannot be parsed as URL-encoded JSON", () => {
    process.env.UE_LOC_COOKIE = "not%20valid%20json";
    expect(() => buildFeedCookieHeader(0, 0)).toThrow(/parsed/);
  });
});
