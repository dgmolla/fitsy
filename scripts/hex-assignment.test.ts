import { assignToHexes } from "./hex-assignment";
import type { OvertureRestaurant } from "./overture-discovery";

/** Helper to build a minimal OvertureRestaurant for testing. */
function makeRestaurant(
  overrides: Partial<OvertureRestaurant> & { lat: number; lng: number },
): OvertureRestaurant {
  return {
    overtureId: overrides.overtureId ?? `id-${Math.random()}`,
    name: overrides.name ?? "Test Restaurant",
    category: overrides.category ?? "restaurant",
    address: overrides.address ?? "123 Main St",
    city: overrides.city ?? "Los Angeles",
    zip: overrides.zip ?? "90012",
    state: overrides.state ?? "CA",
    website: overrides.website ?? null,
    phone: overrides.phone ?? null,
    brandName: overrides.brandName ?? null,
    confidence: overrides.confidence ?? 0.9,
    lat: overrides.lat,
    lng: overrides.lng,
  };
}

describe("assignToHexes", () => {
  it("assigns restaurants to correct hexes", () => {
    // LA Downtown and Santa Monica are in different H3 res-7 hexes
    const downtown = makeRestaurant({ overtureId: "r1", lat: 34.0522, lng: -118.2437 });
    const santaMonica = makeRestaurant({ overtureId: "r2", lat: 34.0195, lng: -118.4912 });

    const result = assignToHexes([downtown, santaMonica]);

    // Should produce exactly 2 hex buckets
    expect(result.size).toBe(2);

    // Each hex should contain exactly the right restaurant
    const downtownHex = "8729a1d75ffffff";
    const santaMonicaHex = "8729a19aaffffff";
    expect(result.get(downtownHex)).toEqual([downtown]);
    expect(result.get(santaMonicaHex)).toEqual([santaMonica]);
  });

  it("loses no restaurants (sum of all hex arrays === input length)", () => {
    const restaurants = [
      makeRestaurant({ overtureId: "a", lat: 34.0522, lng: -118.2437 }),
      makeRestaurant({ overtureId: "b", lat: 34.0195, lng: -118.4912 }),
      makeRestaurant({ overtureId: "c", lat: 34.0525, lng: -118.2440 }),
      makeRestaurant({ overtureId: "d", lat: 33.9500, lng: -118.4000 }),
      makeRestaurant({ overtureId: "e", lat: 34.1000, lng: -118.3500 }),
    ];

    const result = assignToHexes(restaurants);

    let total = 0;
    for (const bucket of result.values()) {
      total += bucket.length;
    }
    expect(total).toBe(restaurants.length);
  });

  it("has no duplicate restaurants across hexes", () => {
    const restaurants = [
      makeRestaurant({ overtureId: "a", lat: 34.0522, lng: -118.2437 }),
      makeRestaurant({ overtureId: "b", lat: 34.0195, lng: -118.4912 }),
      makeRestaurant({ overtureId: "c", lat: 34.0525, lng: -118.2440 }),
      makeRestaurant({ overtureId: "d", lat: 33.9500, lng: -118.4000 }),
    ];

    const result = assignToHexes(restaurants);

    const allIds: string[] = [];
    for (const bucket of result.values()) {
      for (const r of bucket) {
        allIds.push(r.overtureId);
      }
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("returns empty map for empty input", () => {
    const result = assignToHexes([]);
    expect(result.size).toBe(0);
  });

  it("groups nearby restaurants into the same hex", () => {
    // All three coords are within the same H3 res-7 hex (LA Downtown)
    const restaurants = [
      makeRestaurant({ overtureId: "x1", lat: 34.0522, lng: -118.2437 }),
      makeRestaurant({ overtureId: "x2", lat: 34.0525, lng: -118.2440 }),
      makeRestaurant({ overtureId: "x3", lat: 34.0520, lng: -118.2435 }),
    ];

    const result = assignToHexes(restaurants);

    expect(result.size).toBe(1);
    const [bucket] = result.values();
    expect(bucket).toHaveLength(3);
  });

  it("supports custom resolution", () => {
    const restaurant = makeRestaurant({ overtureId: "r1", lat: 34.0522, lng: -118.2437 });

    const res7 = assignToHexes([restaurant], 7);
    const res8 = assignToHexes([restaurant], 8);

    // Different resolutions produce different hex IDs
    const [hexId7] = res7.keys();
    const [hexId8] = res8.keys();
    expect(hexId7).not.toBe(hexId8);

    // Verify the known hex IDs at each resolution
    expect(hexId7).toBe("8729a1d75ffffff");
    expect(hexId8).toBe("8829a1d757fffff");
  });
});
