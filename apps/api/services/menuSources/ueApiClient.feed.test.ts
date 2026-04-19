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

  it("overrides latitude and longitude while preserving the cosmetic fields", () => {
    const original = {
      address: { address1: "Los Angeles" },
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
    expect(decoded.reference).toBe("here:af:streetsection:abc");
    expect((decoded.address as { address1: string }).address1).toBe("Los Angeles");
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
