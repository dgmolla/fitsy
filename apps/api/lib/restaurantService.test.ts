import type { ConfidenceLevel } from "@fitsy/shared";

// ─── Mock Prisma before importing the service ──────────────────────────────────
//
// restaurantService.ts uses a globalThis singleton pattern:
//   globalForPrisma.prisma ?? new PrismaClient()
// We must clear the singleton between tests so each test gets a fresh mock
// instance. We expose module-level mock refs so individual tests can configure
// return values without re-importing.

const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    restaurant: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
    },
  })),
}));

// Clear the singleton stored on globalThis before each test so a fresh
// PrismaClient mock instance is created when the service module runs.
beforeEach(() => {
  const g = globalThis as unknown as { prisma?: unknown };
  delete g.prisma;
  mockFindMany.mockReset();
  mockFindUnique.mockReset();
});

// Import AFTER jest.mock so the mock is in place when the module initialises.
import { findNearbyRestaurants, getRestaurantMenu } from "./restaurantService";
import type { NearbyRestaurantsParams } from "./restaurantService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface MockMacroEstimate {
  id: string;
  menuItemId: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: ConfidenceLevel;
  hadPhoto: boolean;
  estimatedAt: Date;
}

interface MockMenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
  macroEstimates: MockMacroEstimate[];
}

interface MockRestaurant {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  cuisineTags: string[];
  chainFlag: boolean;
  menuItems: MockMenuItem[];
}

function makeMacroEstimate(overrides: Partial<MockMacroEstimate> = {}): MockMacroEstimate {
  return {
    id: "est-1",
    menuItemId: "item-1",
    calories: 600,
    proteinG: 40,
    carbsG: 60,
    fatG: 20,
    confidence: "HIGH",
    hadPhoto: false,
    estimatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeMenuItem(overrides: Partial<MockMenuItem> = {}): MockMenuItem {
  return {
    id: "item-1",
    restaurantId: "rest-1",
    name: "Grilled Chicken",
    description: null,
    category: null,
    price: null,
    macroEstimates: [makeMacroEstimate()],
    ...overrides,
  };
}

function makeRestaurant(overrides: Partial<MockRestaurant> = {}): MockRestaurant {
  return {
    id: "rest-1",
    name: "Test Restaurant",
    address: "123 Main St",
    // Default position: exactly at the user origin so distance = 0
    lat: 34.0,
    lng: -118.0,
    cuisineTags: ["american"],
    chainFlag: false,
    menuItems: [makeMenuItem()],
    ...overrides,
  };
}

// Default search params centred on (34.0, -118.0), 5-mile radius
const BASE_PARAMS: NearbyRestaurantsParams = {
  lat: 34.0,
  lng: -118.0,
  radiusMiles: 5,
  targets: {},
  limit: 10,
};

// ─── findNearbyRestaurants ────────────────────────────────────────────────────

describe("findNearbyRestaurants", () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("returns restaurants within radius", async () => {
    const r1 = makeRestaurant({ id: "rest-1", lat: 34.0, lng: -118.0 });
    const r2 = makeRestaurant({ id: "rest-2", lat: 34.01, lng: -118.01 });
    mockFindMany.mockResolvedValue([r1, r2]);

    const result = await findNearbyRestaurants(BASE_PARAMS);

    expect(result.data).toHaveLength(2);
    expect(result.data.map((r) => r.id)).toEqual(
      expect.arrayContaining(["rest-1", "rest-2"]),
    );
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("filters out restaurants outside true radius", async () => {
    // Place restaurant well beyond 5 miles. At lat=34, 1 degree lat ≈ 69 miles.
    // 6 miles north = 6/69 ≈ 0.087 degrees, which is outside a 5-mile radius
    // even though it may be inside the bounding box square corner.
    const inRange = makeRestaurant({ id: "in-range", lat: 34.0, lng: -118.0 });
    const outOfRange = makeRestaurant({
      id: "out-of-range",
      lat: 34.09, // ~6.2 miles north — beyond 5-mile radius
      lng: -118.0,
    });
    mockFindMany.mockResolvedValue([inRange, outOfRange]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      radiusMiles: 5,
    });

    expect(result.data.map((r) => r.id)).toContain("in-range");
    expect(result.data.map((r) => r.id)).not.toContain("out-of-range");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("sorts by match score when targets provided — better-scoring restaurant comes first", async () => {
    // r1 has an item that perfectly matches the calorie target (score = 0)
    const r1 = makeRestaurant({
      id: "perfect-match",
      lat: 34.04, // farther
      menuItems: [
        makeMenuItem({
          id: "item-perfect",
          macroEstimates: [makeMacroEstimate({ calories: 600 })],
        }),
      ],
    });
    // r2 has an item far from the target
    const r2 = makeRestaurant({
      id: "poor-match",
      lat: 34.0, // closer
      menuItems: [
        makeMenuItem({
          id: "item-poor",
          macroEstimates: [makeMacroEstimate({ calories: 1200 })],
        }),
      ],
    });
    mockFindMany.mockResolvedValue([r1, r2]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: { calories: 600 },
    });

    expect(result.data[0]?.id).toBe("perfect-match");
    expect(result.data[1]?.id).toBe("poor-match");
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("sorts by distance when no targets — closer restaurant comes first", async () => {
    const closer = makeRestaurant({ id: "closer", lat: 34.0, lng: -118.0 }); // distance = 0
    const farther = makeRestaurant({ id: "farther", lat: 34.02, lng: -118.0 }); // ~1.4 miles
    mockFindMany.mockResolvedValue([farther, closer]); // returned out of order by DB

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: {}, // no targets → sort by distance
    });

    expect(result.data[0]?.id).toBe("closer");
    expect(result.data[1]?.id).toBe("farther");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("applies cuisineType filter — passes cuisineTags has-clause to Prisma", async () => {
    mockFindMany.mockResolvedValue([]);

    await findNearbyRestaurants({
      ...BASE_PARAMS,
      cuisineType: "italian",
    });

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const [callArg] = mockFindMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(callArg.where).toMatchObject({
      cuisineTags: { has: "italian" },
    });
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("applies chainOnly filter — passes chainFlag clause to Prisma", async () => {
    mockFindMany.mockResolvedValue([]);

    await findNearbyRestaurants({
      ...BASE_PARAMS,
      chainOnly: true,
    });

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const [callArg] = mockFindMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(callArg.where).toMatchObject({ chainFlag: true });
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it("respects limit — returns at most limit restaurants", async () => {
    const restaurants = Array.from({ length: 5 }, (_, i) =>
      makeRestaurant({ id: `rest-${i}`, lat: 34.0, lng: -118.0 }),
    );
    mockFindMany.mockResolvedValue(restaurants);

    const result = await findNearbyRestaurants({ ...BASE_PARAMS, limit: 3 });

    expect(result.data).toHaveLength(3);
    expect(result.total).toBe(5); // total reflects all in-radius, not paginated
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it("returns distanceMiles rounded to 2 decimal places", async () => {
    // Place restaurant at a position that yields a non-integer distance
    const r = makeRestaurant({ id: "rest-1", lat: 34.01, lng: -118.01 });
    mockFindMany.mockResolvedValue([r]);

    const result = await findNearbyRestaurants(BASE_PARAMS);

    const dist = result.data[0]?.distanceMiles ?? 0;
    // Verify it has at most 2 decimal places
    const asString = dist.toString();
    const decimalPart = asString.split(".")[1] ?? "";
    expect(decimalPart.length).toBeLessThanOrEqual(2);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it("returns bestMatch with correct fields and matchScore when targets match", async () => {
    const r = makeRestaurant({
      id: "rest-1",
      lat: 34.0,
      menuItems: [
        makeMenuItem({
          id: "item-1",
          name: "Grilled Chicken",
          macroEstimates: [
            makeMacroEstimate({
              calories: 600,
              proteinG: 40,
              carbsG: 60,
              fatG: 20,
              confidence: "HIGH",
            }),
          ],
        }),
      ],
    });
    mockFindMany.mockResolvedValue([r]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: { calories: 600, proteinG: 40 },
    });

    const best = result.data[0]?.bestMatch;
    expect(best).not.toBeNull();
    expect(best?.menuItemId).toBe("item-1");
    expect(best?.name).toBe("Grilled Chicken");
    expect(best?.calories).toBe(600);
    expect(best?.proteinG).toBe(40);
    expect(best?.carbsG).toBe(60);
    expect(best?.fatG).toBe(20);
    expect(best?.confidence).toBe("HIGH");
    expect(typeof best?.matchScore).toBe("number");
    // Perfect match → score should be 0
    expect(best?.matchScore).toBe(0);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it("returns bestMatch: null when no targets", async () => {
    const r = makeRestaurant({ id: "rest-1", lat: 34.0 });
    mockFindMany.mockResolvedValue([r]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: {},
    });

    expect(result.data[0]?.bestMatch).toBeNull();
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it("returns bestMatch: null when no menu items have estimates", async () => {
    const r = makeRestaurant({
      id: "rest-1",
      lat: 34.0,
      menuItems: [
        makeMenuItem({ id: "item-no-est", macroEstimates: [] }),
      ],
    });
    mockFindMany.mockResolvedValue([r]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: { calories: 600 },
    });

    expect(result.data[0]?.bestMatch).toBeNull();
  });
});

// ─── getRestaurantMenu ────────────────────────────────────────────────────────

describe("getRestaurantMenu", () => {
  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it("returns null for unknown restaurant", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await getRestaurantMenu("nonexistent-id");

    expect(result).toBeNull();
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it("returns restaurant with menu items — correct shape", async () => {
    const r = makeRestaurant({
      id: "rest-1",
      name: "Good Eats",
      menuItems: [
        makeMenuItem({ id: "item-1", name: "Salad" }),
        makeMenuItem({ id: "item-2", name: "Burger" }),
      ],
    });
    mockFindUnique.mockResolvedValue(r);

    const result = await getRestaurantMenu("rest-1");

    expect(result).not.toBeNull();
    expect(result?.restaurantId).toBe("rest-1");
    expect(result?.restaurantName).toBe("Good Eats");
    expect(result?.menuItems).toHaveLength(2);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it("maps macros from the latest estimate (first element in array)", async () => {
    const estimatedAt = new Date("2025-06-15T12:00:00.000Z");
    const r = makeRestaurant({
      id: "rest-1",
      menuItems: [
        makeMenuItem({
          id: "item-1",
          name: "Salad",
          macroEstimates: [
            makeMacroEstimate({
              calories: 450,
              proteinG: 30,
              carbsG: 40,
              fatG: 15,
              confidence: "MEDIUM",
              hadPhoto: true,
              estimatedAt,
            }),
          ],
        }),
      ],
    });
    mockFindUnique.mockResolvedValue(r);

    const result = await getRestaurantMenu("rest-1");

    const macros = result?.menuItems[0]?.macros;
    expect(macros).not.toBeNull();
    expect(macros?.calories).toBe(450);
    expect(macros?.proteinG).toBe(30);
    expect(macros?.carbsG).toBe(40);
    expect(macros?.fatG).toBe(15);
    expect(macros?.confidence).toBe("MEDIUM");
    expect(macros?.hadPhoto).toBe(true);
    expect(macros?.estimatedAt).toBe("2025-06-15T12:00:00.000Z");
  });

  // ── Test 15 ─────────────────────────────────────────────────────────────────
  it("returns macros: null when item has no estimates", async () => {
    const r = makeRestaurant({
      id: "rest-1",
      menuItems: [makeMenuItem({ id: "item-no-est", macroEstimates: [] })],
    });
    mockFindUnique.mockResolvedValue(r);

    const result = await getRestaurantMenu("rest-1");

    expect(result?.menuItems[0]?.macros).toBeNull();
  });

  // ── Test 16 ─────────────────────────────────────────────────────────────────
  it("includes optional fields when present — description, category, price", async () => {
    const r = makeRestaurant({
      id: "rest-1",
      menuItems: [
        makeMenuItem({
          id: "item-1",
          description: "Fresh garden salad",
          category: "Starters",
          price: 12.99,
        }),
      ],
    });
    mockFindUnique.mockResolvedValue(r);

    const result = await getRestaurantMenu("rest-1");

    const item = result?.menuItems[0];
    expect(item?.description).toBe("Fresh garden salad");
    expect(item?.category).toBe("Starters");
    expect(item?.price).toBe(12.99);
  });

  // ── Test 17 ─────────────────────────────────────────────────────────────────
  it("omits optional fields when null — description, category, price absent from output", async () => {
    const r = makeRestaurant({
      id: "rest-1",
      menuItems: [
        makeMenuItem({
          id: "item-1",
          description: null,
          category: null,
          price: null,
        }),
      ],
    });
    mockFindUnique.mockResolvedValue(r);

    const result = await getRestaurantMenu("rest-1");

    const item = result?.menuItems[0];
    expect(item).not.toHaveProperty("description");
    expect(item).not.toHaveProperty("category");
    expect(item).not.toHaveProperty("price");
  });

  // ── Test 18 ─────────────────────────────────────────────────────────────────
  it("passes orderBy name asc to Prisma for menu items", async () => {
    const r = makeRestaurant({
      id: "rest-1",
      menuItems: [
        makeMenuItem({ id: "item-z", name: "Zucchini Soup" }),
        makeMenuItem({ id: "item-a", name: "Apple Salad" }),
      ],
    });
    mockFindUnique.mockResolvedValue(r);

    await getRestaurantMenu("rest-1");

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    const [callArg] = mockFindUnique.mock.calls[0] as [
      {
        where: { id: string };
        include: {
          menuItems: { orderBy: { name: string }; include: unknown };
        };
      },
    ];
    expect(callArg.include.menuItems.orderBy).toEqual({ name: "asc" });
  });
});
