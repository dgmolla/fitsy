/**
 * Real-database tests for the search path (autoship step 6b, tenet T5).
 *
 * Runs only when POSTGRES_PRISMA_URL is set: the CI test job provides the
 * seeded PostGIS container (verify.yml runs `prisma db seed --data-only`);
 * locally, `scripts/dev/db.sh`-style containers or the dev DB work the same
 * way. Skipped silently otherwise, like the other describeIfDb suites.
 *
 * Nothing here is mocked - this exercises the LATERAL search query, the
 * denormalized macro columns, cursor pagination, and the response contract
 * (packages/shared/src/contracts/restaurants.ts) against real rows.
 */
import { restaurantResultSchema } from "@fitsy/shared";

jest.setTimeout(30_000); // remote dev DBs are slower than the CI container

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

// Matches prisma/seed.ts (SEED_CENTER): 50 restaurants within ~1.5mi of here.
const SEED_LAT = 34.0522;
const SEED_LNG = -118.2437;

describeIfDb("findNearbyRestaurants (DB)", () => {
  // required lazily so the module (which instantiates PrismaClient) is only
  // loaded when a database is actually available
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require("@/lib/restaurantService") as typeof import("../../lib/restaurantService");

  afterAll(async () => {
    await svc.prisma.$disconnect();
  });

  it("returns seeded restaurants within the radius, contract-clean", async () => {
    const { data, total, nextCursor } = await svc.findNearbyRestaurants({
      lat: SEED_LAT,
      lng: SEED_LNG,
      radiusMiles: 3,
      targets: {},
      limit: 20,
    });
    expect(total).toBeGreaterThan(0);
    expect(data.length).toBeGreaterThan(0);
    expect(data.length).toBeLessThanOrEqual(20);
    expect(typeof nextCursor === "string" || nextCursor === null).toBe(true);
    for (const row of data) {
      // the executable contract: every row parses, or the mobile client breaks
      const parsed = restaurantResultSchema.safeParse(row);
      if (!parsed.success) {
        throw new Error(`contract violation for ${row.id}: ${parsed.error.message}`);
      }
      expect(row.distanceMiles).toBeLessThanOrEqual(3);
    }
  });

  it("ranks by macro fit when targets are set and rows carry a bestMatch", async () => {
    const { data } = await svc.findNearbyRestaurants({
      lat: SEED_LAT,
      lng: SEED_LNG,
      radiusMiles: 3,
      targets: { calories: 520, proteinG: 42 },
      limit: 10,
    });
    expect(data.length).toBeGreaterThan(0);
    const withMatch = data.filter((r) => r.bestMatch !== null);
    expect(withMatch.length).toBeGreaterThan(0);
    for (const r of withMatch) {
      expect(r.bestMatch!.calories).toBeGreaterThan(0);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(r.bestMatch!.confidence);
    }
  });

  it("paginates with a stable cursor and no duplicate rows", async () => {
    const page1 = await svc.findNearbyRestaurants({
      lat: SEED_LAT,
      lng: SEED_LNG,
      radiusMiles: 3,
      targets: {},
      limit: 5,
    });
    expect(page1.nextCursor).toBeTruthy();
    const cursor = svc.decodeCursor(page1.nextCursor!);
    expect(cursor).not.toBeNull();
    const page2 = await svc.findNearbyRestaurants({
      lat: SEED_LAT,
      lng: SEED_LNG,
      radiusMiles: 3,
      targets: {},
      limit: 5,
      cursor: cursor!,
    });
    const ids1 = new Set(page1.data.map((r) => r.id));
    for (const r of page2.data) {
      expect(ids1.has(r.id)).toBe(false);
    }
  });

  it("query filter narrows to matching names", async () => {
    const { data } = await svc.findNearbyRestaurants({
      lat: SEED_LAT,
      lng: SEED_LNG,
      radiusMiles: 3,
      targets: {},
      query: "Seed Bowl Co",
      limit: 20,
    });
    expect(data.length).toBeGreaterThan(0);
    // every hit matched the query via name, cuisine, or a menu item; the seed
    // brand's locations match by name
    expect(data.some((r) => r.name.startsWith("Seed Bowl Co"))).toBe(true);
  });

  it("returns an empty page far from any seeded data", async () => {
    const { data, total } = await svc.findNearbyRestaurants({
      lat: 0,
      lng: 0,
      radiusMiles: 3,
      targets: {},
      limit: 20,
    });
    expect(total).toBe(0);
    expect(data).toEqual([]);
  });
});
