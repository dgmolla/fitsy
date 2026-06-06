import type { ConfidenceLevel } from "@fitsy/shared";

// ─── Mock Prisma before importing the service ──────────────────────────────────
//
// restaurantService.ts uses a globalThis singleton pattern:
//   globalForPrisma.prisma ?? new PrismaClient()
// We must clear the singleton between tests so each test gets a fresh mock
// instance. We expose module-level mock refs so individual tests can configure
// return values without re-importing.

const mockQueryRaw = jest.fn();
const mockFindUnique = jest.fn();

jest.mock("@prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
    join: (items: unknown[], sep = ",") => ({ items, sep }),
    empty: { empty: true },
  },
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRaw: mockQueryRaw,
    restaurant: {
      findUnique: mockFindUnique,
    },
  })),
}));

// Clear the singleton stored on globalThis before each test so a fresh
// PrismaClient mock instance is created when the service module runs.
beforeEach(() => {
  const g = globalThis as unknown as { prisma?: unknown };
  delete g.prisma;
  mockQueryRaw.mockReset();
  mockFindUnique.mockReset();
});

// Import AFTER jest.mock so the mock is in place when the module initialises.
import {
  findNearbyRestaurants,
  getRestaurantMenu,
  encodeCursor,
  decodeCursor,
} from "./restaurantService";
import type { NearbyRestaurantsParams } from "./restaurantService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface ScoredRowFixture {
  restaurantId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  cuisineTags: string[];
  chainFlag: boolean;
  photoUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  dietaryOptions: string[];
  menuItemId: string;
  itemName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: ConfidenceLevel;
  scoreSum: number;
  distanceMiles: number;
  orderKey: number;
}

function makeScoredRow(overrides: Partial<ScoredRowFixture> = {}): ScoredRowFixture {
  const base = {
    restaurantId: "rest-1",
    name: "Test Restaurant",
    address: "123 Main St",
    lat: 34.0,
    lng: -118.0,
    cuisineTags: ["american"],
    chainFlag: false,
    photoUrl: null,
    rating: null,
    priceLevel: null,
    dietaryOptions: [],
    menuItemId: "item-1",
    itemName: "Grilled Chicken",
    calories: 600,
    proteinG: 40,
    carbsG: 60,
    fatG: 20,
    confidence: "HIGH" as ConfidenceLevel,
    scoreSum: 0,
    distanceMiles: 0,
    ...overrides,
  };
  // Default orderKey to the distanceMiles unless explicitly overridden — tests
  // that don't care about composite ranking get the historical behavior for
  // free.
  return { ...base, orderKey: overrides.orderKey ?? base.distanceMiles };
}

const BASE_PARAMS: NearbyRestaurantsParams = {
  lat: 34.0,
  lng: -118.0,
  radiusMiles: 5,
  targets: {},
  limit: 10,
};

// ─── findNearbyRestaurants ────────────────────────────────────────────────────

describe("findNearbyRestaurants", () => {
  it("returns restaurants from the DISTINCT ON query result", async () => {
    mockQueryRaw.mockResolvedValue([
      makeScoredRow({ restaurantId: "rest-1", distanceMiles: 0 }),
      makeScoredRow({ restaurantId: "rest-2", distanceMiles: 1.5 }),
    ]);

    const result = await findNearbyRestaurants(BASE_PARAMS);

    expect(result.data).toHaveLength(2);
    expect(result.data.map((r) => r.id)).toEqual(["rest-1", "rest-2"]);
    expect(result.total).toBe(2);
  });

  it("preserves DB row order (DB already applied radius filter + scoring sort)", async () => {
    // DB returns them in the order the SQL ORDER BY produced
    mockQueryRaw.mockResolvedValue([
      makeScoredRow({ restaurantId: "best", scoreSum: 0.01, distanceMiles: 2 }),
      makeScoredRow({ restaurantId: "worse", scoreSum: 0.5, distanceMiles: 0.5 }),
    ]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: { calories: 600 },
    });

    expect(result.data[0]?.id).toBe("best");
    expect(result.data[1]?.id).toBe("worse");
  });

  it("respects limit — SQL pushes LIMIT down so data and total reflect the bounded result", async () => {
    // With LIMIT pushed into SQL, the DB returns at most `limit` rows.
    // Both `data.length` and `total` reflect that bounded result.
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeScoredRow({ restaurantId: `rest-${i}` }),
    );
    mockQueryRaw.mockResolvedValue(rows);

    const result = await findNearbyRestaurants({ ...BASE_PARAMS, limit: 3 });

    expect(result.data).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it("returns distanceMiles rounded to 2 decimal places", async () => {
    mockQueryRaw.mockResolvedValue([
      makeScoredRow({ distanceMiles: 1.23456789 }),
    ]);

    const result = await findNearbyRestaurants(BASE_PARAMS);

    expect(result.data[0]?.distanceMiles).toBe(1.23);
  });

  it("computes matchScore = sqrt(scoreSum) when targets are active", async () => {
    // scoreSum of 0.04 → sqrt = 0.2
    mockQueryRaw.mockResolvedValue([makeScoredRow({ scoreSum: 0.04 })]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: { calories: 600 },
    });

    expect(result.data[0]?.bestMatch?.matchScore).toBe(0.2);
  });

  it("sets matchScore to Infinity when no targets provided (score is meaningless)", async () => {
    mockQueryRaw.mockResolvedValue([makeScoredRow({ scoreSum: 0 })]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: {},
    });

    expect(result.data[0]?.bestMatch?.matchScore).toBe(Infinity);
  });

  it("perfect match (scoreSum = 0) produces matchScore = 0", async () => {
    mockQueryRaw.mockResolvedValue([makeScoredRow({ scoreSum: 0 })]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: { calories: 600, proteinG: 40 },
    });

    expect(result.data[0]?.bestMatch?.matchScore).toBe(0);
  });

  it("maps bestMatch fields from the winning row", async () => {
    mockQueryRaw.mockResolvedValue([
      makeScoredRow({
        menuItemId: "item-7",
        itemName: "Turkey Bowl",
        calories: 550,
        proteinG: 45,
        carbsG: 55,
        fatG: 18,
        confidence: "MEDIUM",
      }),
    ]);

    const result = await findNearbyRestaurants({
      ...BASE_PARAMS,
      targets: { calories: 600 },
    });

    const best = result.data[0]?.bestMatch;
    expect(best?.menuItemId).toBe("item-7");
    expect(best?.name).toBe("Turkey Bowl");
    expect(best?.calories).toBe(550);
    expect(best?.proteinG).toBe(45);
    expect(best?.carbsG).toBe(55);
    expect(best?.fatG).toBe(18);
    expect(best?.confidence).toBe("MEDIUM");
  });

  it("includes optional fields (photoUrl, rating, priceLevel, dietaryOptions) when present", async () => {
    mockQueryRaw.mockResolvedValue([
      makeScoredRow({
        photoUrl: "https://example.com/photo.jpg",
        rating: 4.5,
        priceLevel: "$$",
        dietaryOptions: ["has_vegan"],
      }),
    ]);

    const result = await findNearbyRestaurants(BASE_PARAMS);

    const r = result.data[0]!;
    expect(r.photoUrl).toBe("https://example.com/photo.jpg");
    expect(r.rating).toBe(4.5);
    expect(r.priceLevel).toBe("$$");
    expect(r.dietaryOptions).toEqual(["has_vegan"]);
  });

  it("omits optional fields when null/empty", async () => {
    mockQueryRaw.mockResolvedValue([
      makeScoredRow({
        photoUrl: null,
        rating: null,
        priceLevel: null,
        dietaryOptions: [],
      }),
    ]);

    const result = await findNearbyRestaurants(BASE_PARAMS);

    const r = result.data[0]!;
    expect(r).not.toHaveProperty("photoUrl");
    expect(r).not.toHaveProperty("rating");
    expect(r).not.toHaveProperty("priceLevel");
    expect(r).not.toHaveProperty("dietaryOptions");
  });

  it("invokes $queryRaw exactly once per call", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await findNearbyRestaurants(BASE_PARAMS);

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns empty result when no rows match", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const result = await findNearbyRestaurants(BASE_PARAMS);

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  // ─── Cursor pagination ──────────────────────────────────────────────────────

  it("returns nextCursor: null when fewer rows came back than the requested limit (last page)", async () => {
    // Asked for 10, DB returned 3 → exhausted, no more pages.
    mockQueryRaw.mockResolvedValue([
      makeScoredRow({ restaurantId: "rest-1", distanceMiles: 0.1 }),
      makeScoredRow({ restaurantId: "rest-2", distanceMiles: 0.5 }),
      makeScoredRow({ restaurantId: "rest-3", distanceMiles: 1.0 }),
    ]);

    const result = await findNearbyRestaurants({ ...BASE_PARAMS, limit: 10 });

    expect(result.nextCursor).toBeNull();
  });

  it("returns nextCursor: null when zero rows match", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const result = await findNearbyRestaurants(BASE_PARAMS);

    expect(result.nextCursor).toBeNull();
  });

  it("returns an encoded nextCursor when the page is full — decodes to last row's { id, orderKey, distanceMiles }", async () => {
    // Asked for 2, DB returned 2 → could be more, emit a cursor.
    mockQueryRaw.mockResolvedValue([
      makeScoredRow({ restaurantId: "rest-1", distanceMiles: 0.5 }),
      makeScoredRow({ restaurantId: "rest-2", distanceMiles: 1.25 }),
    ]);

    const result = await findNearbyRestaurants({ ...BASE_PARAMS, limit: 2 });

    expect(result.nextCursor).not.toBeNull();
    const decoded = decodeCursor(result.nextCursor as string);
    expect(decoded).toEqual({ id: "rest-2", orderKey: 1.25, distanceMiles: 1.25 });
  });

  it("paginates stably across two restaurants at the same lat/lng (equal distances)", async () => {
    // Page 1: two restaurants at the same coords → equal distanceMiles. Sort
    // tie-break is by id ASC, so rest-A precedes rest-B. Cursor must capture
    // the last row's id so page 2 strictly starts after rest-B.
    mockQueryRaw.mockResolvedValueOnce([
      makeScoredRow({
        restaurantId: "rest-A",
        lat: 34.05,
        lng: -118.24,
        distanceMiles: 1.0,
      }),
      makeScoredRow({
        restaurantId: "rest-B",
        lat: 34.05,
        lng: -118.24,
        distanceMiles: 1.0,
      }),
    ]);

    const page1 = await findNearbyRestaurants({ ...BASE_PARAMS, limit: 2 });

    expect(page1.data.map((r) => r.id)).toEqual(["rest-A", "rest-B"]);
    expect(page1.nextCursor).not.toBeNull();
    const cursor = decodeCursor(page1.nextCursor as string);
    expect(cursor).toEqual({ id: "rest-B", orderKey: 1.0, distanceMiles: 1.0 });

    // Page 2: with the cursor forwarded, only rest-C (further out) survives.
    mockQueryRaw.mockResolvedValueOnce([
      makeScoredRow({
        restaurantId: "rest-C",
        lat: 34.06,
        lng: -118.25,
        distanceMiles: 1.5,
      }),
    ]);

    const page2 = await findNearbyRestaurants({
      ...BASE_PARAMS,
      limit: 2,
      cursor: cursor!,
    });

    expect(page2.data.map((r) => r.id)).toEqual(["rest-C"]);
    expect(page2.nextCursor).toBeNull();
  });
  // ─── Free-text query ──────────────────────────────────────────────────────

  // The Prisma mock turns every Prisma.sql`...` into { strings, values } and
  // Prisma.join into { items, sep }, so the composed query is a tree. Collect
  // every primitive string value so we can assert how the text filter was
  // wired in without depending on fragment nesting.
  function collectStrings(node: unknown, out: string[] = []): string[] {
    if (typeof node === "string") {
      out.push(node);
    } else if (Array.isArray(node)) {
      for (const v of node) collectStrings(v, out);
    } else if (node && typeof node === "object") {
      for (const v of Object.values(node)) collectStrings(v, out);
    }
    return out;
  }

  function capturedSqlStrings(): string[] {
    const call = mockQueryRaw.mock.calls[0] as unknown[];
    return collectStrings(call);
  }

  it("matches via full-text search, binding the raw query text", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await findNearbyRestaurants({ ...BASE_PARAMS, query: "poke" });

    const strings = capturedSqlStrings();
    // Raw query text is bound as a parameter; plainto_tsquery parses it safely.
    expect(strings).toContain("poke");
    const sql = strings.join("");
    expect(sql).toContain("to_tsvector");
    expect(sql).toContain("plainto_tsquery");
  });

  it("matches name, cuisine, and menu item names — NOT descriptions", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await findNearbyRestaurants({ ...BASE_PARAMS, query: "ramen" });

    const sql = capturedSqlStrings().join("");
    expect(sql).toContain("r.name");
    expect(sql).toContain("mi.name");
    expect(sql).toContain('"cuisineTags"');
    // Descriptions are long prose — low precision; must not be referenced.
    expect(sql).not.toContain("description");
  });

  it("scopes the macro-scored dish (LATERAL alias m) to query-matching items", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await findNearbyRestaurants({ ...BASE_PARAMS, query: "ramen" });

    // The dish we display + macro-rank must come from the query-relevant set,
    // so a "ramen" search highlights the ramen dish, not an unrelated
    // best-macro item. The LATERAL item filter matches alias `m`.
    expect(capturedSqlStrings().join("")).toContain("m.name");
  });

  it("does not wire the text filter when no query is present", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await findNearbyRestaurants(BASE_PARAMS);

    expect(capturedSqlStrings().join("")).not.toContain("to_tsvector");
  });

  it("treats an empty-string query as absent (no text filter)", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await findNearbyRestaurants({ ...BASE_PARAMS, query: "" });

    expect(capturedSqlStrings().join("")).not.toContain("to_tsvector");
  });

  it("binds arbitrary query text verbatim (plainto_tsquery handles parsing)", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await findNearbyRestaurants({ ...BASE_PARAMS, query: "mac & cheese!" });

    // No escaping/sanitizing in our code — the raw text is bound and
    // plainto_tsquery turns it into a safe lexeme query.
    expect(capturedSqlStrings()).toContain("mac & cheese!");
  });
});

// ─── Cursor encoding ──────────────────────────────────────────────────────────

describe("encodeCursor / decodeCursor", () => {
  it("round-trips { id, orderKey, distanceMiles }", () => {
    const original = { id: "rest-42", orderKey: 2.5, distanceMiles: 2.5 };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(original);
  });

  it("accepts legacy { id, distanceMiles } cursors and treats distance as orderKey", () => {
    // Cursors encoded before composite ranking shipped only carried
    // distanceMiles. The decoder must still accept them so in-flight cursors
    // don't 400 the user mid-pagination on rollout.
    const legacy = Buffer.from(
      JSON.stringify({ id: "rest-1", distanceMiles: 1.25 }),
      "utf8",
    ).toString("base64");
    expect(decodeCursor(legacy)).toEqual({
      id: "rest-1",
      orderKey: 1.25,
      distanceMiles: 1.25,
    });
  });

  it("returns null for non-base64 input", () => {
    expect(decodeCursor("not-base64-!!!")).toBeNull();
  });

  it("returns null when JSON is missing required fields", () => {
    const partial = Buffer.from(JSON.stringify({ id: "rest-1" }), "utf8").toString(
      "base64",
    );
    expect(decodeCursor(partial)).toBeNull();
  });

  it("returns null when neither orderKey nor distanceMiles is finite", () => {
    const bad = Buffer.from(
      JSON.stringify({ id: "rest-1", distanceMiles: "nope" }),
      "utf8",
    ).toString("base64");
    expect(decodeCursor(bad)).toBeNull();
  });
});

// ─── getRestaurantMenu ────────────────────────────────────────────────────────

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
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
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
  photoUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  dietaryOptions: string[];
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
  // Default macros mirror the default MacroEstimate so getRestaurantMenu
  // serves them from MenuItem.* (production reads after Step 6 backfill).
  // Override either side to test mismatched / missing scenarios.
  const defaultEstimate = makeMacroEstimate();
  return {
    id: "item-1",
    restaurantId: "rest-1",
    name: "Grilled Chicken",
    description: null,
    category: null,
    price: null,
    calories: defaultEstimate.calories,
    proteinG: defaultEstimate.proteinG,
    carbsG: defaultEstimate.carbsG,
    fatG: defaultEstimate.fatG,
    macroEstimates: [defaultEstimate],
    ...overrides,
  };
}

function makeRestaurant(overrides: Partial<MockRestaurant> = {}): MockRestaurant {
  return {
    id: "rest-1",
    name: "Test Restaurant",
    address: "123 Main St",
    lat: 34.0,
    lng: -118.0,
    cuisineTags: ["american"],
    chainFlag: false,
    photoUrl: null,
    rating: null,
    priceLevel: null,
    dietaryOptions: [],
    menuItems: [makeMenuItem()],
    ...overrides,
  };
}

describe("getRestaurantMenu", () => {
  it("returns null for unknown restaurant", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await getRestaurantMenu("nonexistent-id");

    expect(result).toBeNull();
  });

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

  it("maps macros from MenuItem (denormalized) plus confidence/hadPhoto/estimatedAt from MacroEstimate", async () => {
    const estimatedAt = new Date("2025-06-15T12:00:00.000Z");
    const r = makeRestaurant({
      id: "rest-1",
      menuItems: [
        makeMenuItem({
          id: "item-1",
          name: "Salad",
          // Macros now live on MenuItem itself; MacroEstimate retains
          // confidence/hadPhoto/estimatedAt as audit metadata.
          calories: 450,
          proteinG: 30,
          carbsG: 40,
          fatG: 15,
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

  it("returns macros: null when item has no estimates", async () => {
    const r = makeRestaurant({
      id: "rest-1",
      menuItems: [makeMenuItem({ id: "item-no-est", macroEstimates: [] })],
    });
    mockFindUnique.mockResolvedValue(r);

    const result = await getRestaurantMenu("rest-1");

    expect(result?.menuItems[0]?.macros).toBeNull();
  });

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
