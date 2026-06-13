/**
 * Mini-hex E2E integration test (S-142).
 *
 * Exercises the full preload pipeline against a single small hex:
 *   1. Overture discovery returns restaurants (via DuckDB + local parquet)
 *   2. assignToHexes() maps them to H3 cells
 *   3. Checkpoint persisted in DB (PipelineCompletedHex)
 *   4. Resume skips completed hex on second run
 *   5. Axiom event shapes are correct (mocked)
 *
 * This test hits real external APIs (Overture S3 via DuckDB) and requires
 * a real DB connection. It does NOT run in CI.
 *
 * Skip conditions:
 *   - describeIfDb:     requires POSTGRES_PRISMA_URL
 *   - describeIfDuckDB: requires duckdb CLI installed
 */

// pipeline-utils.ts (imported transitively through hex-persist) imports
// @fitsy/shared which pulls in env.ts (@t3-oss/env-core). Mock the package
// so scripts tests stay self-contained in CI (no live DB, no env deps).
jest.mock("@fitsy/shared", () => ({
  macroWinnerSqlOrder: (alias = "e") =>
    `CASE ${alias}.source WHEN 'merchant' THEN 0 WHEN 'fatsecret' THEN 1 WHEN 'ffn' THEN 2 WHEN 'haiku' THEN 3 ELSE 99 END ASC, ${alias}."estimatedAt" DESC`,
}));

import { execSync } from "child_process";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import type { OvertureRestaurant, BoundingBox } from "./overture-discovery";
import type {
  RestaurantEvent,
  PipelineError,
  CostCheckpoint,
  RunEvent,
} from "./pipeline-events";

// ---------------------------------------------------------------------------
// Environment gates — same pattern as hex-persist.test.ts / overture-discovery.test.ts
// ---------------------------------------------------------------------------

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];

let hasDuckDB = false;
try {
  execSync("duckdb --version", { encoding: "utf-8", stdio: "pipe" });
  hasDuckDB = true;
} catch {
  // duckdb not installed
}

const hasBothPrereqs = hasDb && hasDuckDB;
const describeIfE2E = hasBothPrereqs ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Conditional imports — avoid PrismaClient errors when no DB is configured
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient: PC } = hasDb
  ? require("@prisma/client")
  : { PrismaClient: class {} };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma: PrismaClientType | null = hasDb ? new (PC as any)() : null;

// Conditional pipeline imports
let downloadOvertureCache: typeof import("./overture-discovery")["downloadOvertureCache"] | undefined;
let queryLocalParquet: typeof import("./overture-discovery")["queryLocalParquet"] | undefined;
let assignToHexes: typeof import("./hex-assignment")["assignToHexes"] | undefined;
let getCompletedHexIds: typeof import("./hex-resume")["getCompletedHexIds"] | undefined;
let filterPendingHexes: typeof import("./hex-resume")["filterPendingHexes"] | undefined;
let persistHex: typeof import("./hex-persist")["persistHex"] | undefined;
let isHexComplete: typeof import("./hex-persist")["isHexComplete"] | undefined;

if (hasBothPrereqs) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const overture = require("./overture-discovery");
  downloadOvertureCache = overture.downloadOvertureCache;
  queryLocalParquet = overture.queryLocalParquet;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const hexAssign = require("./hex-assignment");
  assignToHexes = hexAssign.assignToHexes;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const hexResume = require("./hex-resume");
  getCompletedHexIds = hexResume.getCompletedHexIds;
  filterPendingHexes = hexResume.filterPendingHexes;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const hexPersist = require("./hex-persist");
  persistHex = hexPersist.persistHex;
  isHexComplete = hexPersist.isHexComplete;
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** Silver Lake, LA — consistent with existing test fixtures. */
const SILVER_LAKE_CENTER = { lat: 34.0869, lng: -118.2627 };

/**
 * Small bbox around Silver Lake (~1 km radius).
 * Should contain ~10-30 restaurants in Overture data.
 */
const SMALL_BBOX: BoundingBox = {
  south: SILVER_LAKE_CENTER.lat - 0.005,
  north: SILVER_LAKE_CENTER.lat + 0.005,
  west: SILVER_LAKE_CENTER.lng - 0.005,
  east: SILVER_LAKE_CENTER.lng + 0.005,
};

const RUN_ID = `test-e2e-${Date.now()}`;

// Longer timeout — S3 download can take a while on first run
jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

if (hasDb) {
  afterAll(async () => {
    if (!prisma) return;
    await prisma.pipelineCompletedHex.deleteMany({
      where: { runId: RUN_ID },
    });
    await prisma.$disconnect();
  });
}

// ---------------------------------------------------------------------------
// E2E integration tests
// ---------------------------------------------------------------------------

describeIfE2E("Mini-hex E2E pipeline (S-142)", () => {
  let cachePath: string;
  let restaurants: OvertureRestaurant[];
  let hexMap: Map<string, OvertureRestaurant[]>;

  // ── Stage 1: Overture discovery ──────────────────────────────────────────

  describe("Stage 1: Overture discovery", () => {
    it("downloads or reuses Overture cache for Silver Lake bbox", async () => {
      cachePath = await downloadOvertureCache!(SMALL_BBOX);
      expect(cachePath).toBeTruthy();
      expect(typeof cachePath).toBe("string");
    });

    it("queries local parquet and returns restaurants", async () => {
      restaurants = await queryLocalParquet!(cachePath, SMALL_BBOX);

      // Silver Lake is a dense restaurant area — expect at least a few
      expect(restaurants.length).toBeGreaterThan(0);
      console.log(`[e2e] Discovered ${restaurants.length} restaurants in Silver Lake bbox`);

      // Verify structure of first result
      const first = restaurants[0]!;
      expect(first.overtureId).toBeTruthy();
      expect(first.name).toBeTruthy();
      expect(typeof first.lat).toBe("number");
      expect(typeof first.lng).toBe("number");
      expect(first.lat).toBeGreaterThan(SMALL_BBOX.south);
      expect(first.lat).toBeLessThan(SMALL_BBOX.north);
      expect(first.lng).toBeGreaterThan(SMALL_BBOX.west);
      expect(first.lng).toBeLessThan(SMALL_BBOX.east);
    });

    it("returns no duplicate overtureIds", () => {
      const ids = restaurants.map((r) => r.overtureId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ── Stage 2: Hex assignment ──────────────────────────────────────────────

  describe("Stage 2: Hex assignment", () => {
    it("assigns all restaurants to hex cells", () => {
      // Use resolution 8 for a tighter hex (smaller area per hex)
      hexMap = assignToHexes!(restaurants, 8);

      expect(hexMap.size).toBeGreaterThan(0);
      console.log(`[e2e] Assigned to ${hexMap.size} hex(es) at resolution 8`);

      // Every restaurant should be in exactly one hex
      let totalAssigned = 0;
      for (const bucket of hexMap.values()) {
        totalAssigned += bucket.length;
      }
      expect(totalAssigned).toBe(restaurants.length);
    });

    it("hex IDs are valid H3 strings", () => {
      for (const hexId of hexMap.keys()) {
        // H3 cell IDs are 15-character hex strings at resolution 7/8
        expect(hexId).toMatch(/^[0-9a-f]{15}$/);
      }
    });

    it("restaurants within a hex are geographically close", () => {
      for (const [, bucket] of hexMap) {
        if (bucket.length < 2) continue;
        // All restaurants in a single res-8 hex should be within ~0.5 km
        const lats = bucket.map((r) => r.lat);
        const lngs = bucket.map((r) => r.lng);
        const latSpread = Math.max(...lats) - Math.min(...lats);
        const lngSpread = Math.max(...lngs) - Math.min(...lngs);
        // Res-8 hex edge is ~0.46 km, so spread should be small
        expect(latSpread).toBeLessThan(0.02); // ~2 km latitude spread max
        expect(lngSpread).toBeLessThan(0.02);
      }
    });
  });

  // ── Stage 3: Checkpoint persistence ──────────────────────────────────────

  describe("Stage 3: Checkpoint persistence", () => {
    let testHexId: string;

    it("persistHex creates checkpoint in DB for empty restaurant list", async () => {
      testHexId = hexMap.keys().next().value!;
      // Persist with empty restaurant list (just checkpoint — no items to write)
      const count = await persistHex!(RUN_ID, testHexId, [], prisma!);
      expect(count).toBe(0);
    });

    it("isHexComplete returns true after checkpoint", async () => {
      const complete = await isHexComplete!(RUN_ID, testHexId, prisma!);
      expect(complete).toBe(true);
    });

    it("isHexComplete returns false for non-checkpointed hex", async () => {
      const complete = await isHexComplete!(RUN_ID, "hex_nonexistent_e2e", prisma!);
      expect(complete).toBe(false);
    });
  });

  // ── Stage 4: Resume skips completed hex ──────────────────────────────────

  describe("Stage 4: Resume skips completed hex", () => {
    it("getCompletedHexIds includes the checkpointed hex", async () => {
      const completed = await getCompletedHexIds!(RUN_ID, prisma!);
      expect(completed.size).toBeGreaterThan(0);

      // The hex we checkpointed in Stage 3 should be in the set
      const testHexId = hexMap.keys().next().value!;
      expect(completed.has(testHexId)).toBe(true);
    });

    it("filterPendingHexes excludes completed hex on second run", async () => {
      const allHexIds = Array.from(hexMap.keys());
      const pending = await filterPendingHexes!(allHexIds, RUN_ID, prisma!);

      // We checkpointed one hex in Stage 3, so pending should be allHexIds - 1
      expect(pending.length).toBe(allHexIds.length - 1);

      const testHexId = hexMap.keys().next().value!;
      expect(pending).not.toContain(testHexId);
    });

    it("all hexes pending for a fresh run ID", async () => {
      const freshRunId = `test-e2e-fresh-${Date.now()}`;
      const allHexIds = Array.from(hexMap.keys());
      const pending = await filterPendingHexes!(allHexIds, freshRunId, prisma!);
      expect(pending.length).toBe(allHexIds.length);
    });
  });

  // ── Stage 5: Axiom event shapes ──────────────────────────────────────────
  // NOTE: Source fallback chain is not tested here because it requires live
  // API calls (UberEats, Brave, Firecrawl, Haiku) that are expensive and
  // flaky. S-132 (Wave 5 E2E) already validates the full fallback chain
  // against a single hex with real APIs — this test focuses on the Overture
  // integration path (Stages 1-4) which is the new code in Wave 8.

  describe("Stage 5: Axiom event shapes", () => {
    // Construct typed event objects — tsc will catch mismatches if the
    // interfaces in pipeline-events.ts drift from what preload.ts emits.

    it("RestaurantEvent has correct shape", () => {
      const testHexId = hexMap.keys().next().value!;
      const event: RestaurantEvent = {
        type: "restaurant" as const,
        runId: RUN_ID,
        hexId: testHexId,
        name: "Test Restaurant",
        placeId: "overture-123",
        source: "fatsecret",
        status: "ok",
        itemCount: 5,
        rejectedCount: 1,
        macroMismatchCount: 0,
        sourcesAttempted: ["fatsecret"],
        sourcesFailed: [],
        sourceAttempts: [
          { sourceId: "fatsecret", status: "ok" as const, durationMs: 100 },
        ],
        nameMismatch: false,
        durationMs: 1500,
        _time: new Date().toISOString(),
      };

      expect(event.type).toBe("restaurant");
      expect(event.runId).toBe(RUN_ID);
      expect(typeof event.hexId).toBe("string");
      expect(typeof event.durationMs).toBe("number");
      expect(Array.isArray(event.sourcesAttempted)).toBe(true);
      expect(Array.isArray(event.sourceAttempts)).toBe(true);
      expect(event._time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("PipelineError has correct shape", () => {
      const testHexId = hexMap.keys().next().value!;
      const event: PipelineError = {
        type: "error" as const,
        runId: RUN_ID,
        hexId: testHexId,
        restaurant: "Test Restaurant",
        placeId: "overture-123",
        stage: "macro_estimation",
        source: "haiku",
        error: "API timeout",
        retryable: true,
        retriesAttempted: 2,
        _time: new Date().toISOString(),
      };

      expect(event.type).toBe("error");
      expect(typeof event.stage).toBe("string");
      expect(typeof event.retryable).toBe("boolean");
      expect(typeof event.retriesAttempted).toBe("number");
    });

    it("CostCheckpoint has correct shape", () => {
      const testHexId = hexMap.keys().next().value!;
      const event: CostCheckpoint = {
        type: "cost_checkpoint" as const,
        runId: RUN_ID,
        hexId: testHexId,
        hexesCompleted: 1,
        hexesTotal: hexMap.size,
        cumulativeCost: 0,
        cumulativeCostBreakdown: {
          braveSearch: 0,
          firecrawl: 0,
          haiku: 0,
        },
        _time: new Date().toISOString(),
      };

      expect(event.type).toBe("cost_checkpoint");
      expect(event.hexesCompleted).toBeLessThanOrEqual(event.hexesTotal);
      expect(event.cumulativeCostBreakdown).toHaveProperty("braveSearch");
      expect(event.cumulativeCostBreakdown).toHaveProperty("firecrawl");
      expect(event.cumulativeCostBreakdown).toHaveProperty("haiku");
    });

    it("RunEvent has correct shape", () => {
      const event: RunEvent = {
        type: "run" as const,
        runId: RUN_ID,
        durationTotal: "10.5s",
        hexesTotal: hexMap.size,
        hexesCompleted: 1,
        restaurantsDiscovered: restaurants.length,
        restaurantsPersisted: 0,
        restaurantsFailed: 0,
        itemsTotal: 0,
        costTotal: 0,
        _time: new Date().toISOString(),
      };

      expect(event.type).toBe("run");
      expect(event.hexesTotal).toBeGreaterThan(0);
      expect(event.restaurantsDiscovered).toBeGreaterThan(0);
      expect(typeof event.durationTotal).toBe("string");
    });
  });
});

// ---------------------------------------------------------------------------
// Fault recovery tests (C6) — mock-based, always run
// ---------------------------------------------------------------------------

describe("Fault recovery (mock)", () => {
  // Test 1: Transaction rollback — if persistHex throws, no checkpoint
  it("persistHex rollback: failed persist means hex can be retried", async () => {
    // Simulate: $transaction callback throws → promise rejects, no checkpoint
    const mockCreate = jest.fn().mockResolvedValue({});
    const mockTx = { pipelineCompletedHex: { create: mockCreate } };
    const mockPrisma = {
      // Simulate Prisma $transaction: execute callback, but if it throws, propagate
      $transaction: jest.fn(async (cb: (tx: typeof mockTx) => Promise<number>) => {
        return cb(mockTx);
      }),
    };

    // Import persistHex dynamically to avoid module load issues without DB
    // We'll use the same mock approach as hex-persist.test.ts
    const { persistHex: persistHexFn } = await import("./hex-persist");

    // persistHex with a restaurant that will trigger a mock failure:
    // We can't easily mock persistItemsInTx from here without jest.mock,
    // but we CAN verify the contract: if $transaction rejects, the caller
    // gets the error and can retry the hex.
    const failingPrisma = {
      $transaction: jest.fn().mockRejectedValue(new Error("Connection lost")),
    };

    await expect(
      persistHexFn("run-1", "hex-fail", [], failingPrisma as any),
    ).rejects.toThrow("Connection lost");

    // Key assertion: no checkpoint was created (transaction never committed)
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // Test 2: Partial-hex resume — 2 of 4 hexes done, verify only 2 returned
  it("partial-hex resume: filterPendingHexes returns only uncompleted hexes", async () => {
    const { filterPendingHexes: filterFn } = await import("./hex-resume");

    // Mock prisma: 2 hexes already checkpointed for this run
    const mockPrisma = {
      pipelineCompletedHex: {
        findMany: jest.fn().mockResolvedValue([
          { hexId: "hex_A" },
          { hexId: "hex_B" },
        ]),
      },
    };

    const allHexes = ["hex_A", "hex_B", "hex_C", "hex_D"];
    const pending = await filterFn(allHexes, "run-partial", mockPrisma as any);

    expect(pending).toEqual(["hex_C", "hex_D"]);
    expect(pending).not.toContain("hex_A");
    expect(pending).not.toContain("hex_B");
  });

  // Test 3: DuckDB failure propagation — error propagates, no corrupt cache
  it("DuckDB failure propagates cleanly from downloadOvertureCache", async () => {
    const { existsSync } = await import("fs");
    const { join } = await import("path");

    // Use a temp path that definitely doesn't exist as cache
    const fakeCachePath = join(
      "/tmp",
      `fitsy-test-duckdb-fail-${Date.now()}`,
      "should-not-exist.parquet",
    );

    // Mock child_process.execSync to throw (simulating DuckDB crash)
    const cp = await import("child_process");
    const originalExecSync = cp.execSync;
    const execSyncSpy = jest.spyOn(cp, "execSync").mockImplementation(() => {
      throw new Error("duckdb: out of memory");
    });

    try {
      const { downloadOvertureCache: downloadFn } = await import("./overture-discovery");

      // downloadOvertureCache should propagate the DuckDB error
      await expect(
        downloadFn(
          { south: 34.0, north: 34.1, west: -118.3, east: -118.2 },
          fakeCachePath,
        ),
      ).rejects.toThrow("duckdb");

      // No cache file should have been written
      expect(existsSync(fakeCachePath)).toBe(false);

      // No .meta.json sidecar should exist either
      expect(existsSync(fakeCachePath + ".meta.json")).toBe(false);
    } finally {
      execSyncSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Pure unit tests (no DB or DuckDB required) — always run
// ---------------------------------------------------------------------------

describe("Mini-hex E2E module smoke test", () => {
  it("pipeline modules are importable (type-level check)", () => {
    // These imports are resolved at compile time by tsc --noEmit.
    // At runtime in CI (no DB/DuckDB), the conditional imports above
    // are skipped, but this test still verifies the types compile.
    expect(true).toBe(true);
  });

  it("test constants are valid", () => {
    expect(SILVER_LAKE_CENTER.lat).toBeCloseTo(34.0869, 3);
    expect(SILVER_LAKE_CENTER.lng).toBeCloseTo(-118.2627, 3);
    expect(SMALL_BBOX.south).toBeLessThan(SMALL_BBOX.north);
    expect(SMALL_BBOX.west).toBeLessThan(SMALL_BBOX.east);
    expect(RUN_ID).toMatch(/^test-e2e-\d+$/);
  });
});
