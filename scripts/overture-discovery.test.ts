import { execSync } from "child_process";
import { existsSync, mkdirSync, unlinkSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  buildDownloadSQL,
  buildLocalQuerySQL,
  isCacheFresh,
  queryLocalParquet,
  downloadOvertureCache,
} from "./overture-discovery";

// ---------------------------------------------------------------------------
// DuckDB availability check — skip integration tests in CI where duckdb
// is not installed (same pattern as pipeline-completed-hex.test.ts)
// ---------------------------------------------------------------------------

let hasDuckDB = false;
try {
  execSync("duckdb --version", { encoding: "utf-8", stdio: "pipe" });
  hasDuckDB = true;
} catch {
  // duckdb not installed
}

const describeIfDuckDB = hasDuckDB ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Test fixture: create a small parquet file with test data using DuckDB
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), "fitsy-overture-test");
const FIXTURE_PATH = join(TEST_DIR, "test-fixture.parquet");
const CACHE_TEST_PATH = join(TEST_DIR, "cache-test.parquet");

function createFixtureParquet(): void {
  mkdirSync(TEST_DIR, { recursive: true });

  // Create a small parquet with known test data
  const sql = `
COPY (
  SELECT * FROM (VALUES
    ('id-001', 'Taco Bell',    'fast_food',   '123 Main St',     'Los Angeles', '90001', 'CA', 'https://tacobell.com', '+1-555-0001', 'Taco Bell',  0.95, 34.05, -118.25),
    ('id-002', 'Sushi Gen',    'sushi_restaurant', '456 Oak Ave', 'Los Angeles', '90012', 'CA', NULL,                  '+1-555-0002', NULL,         0.80, 34.06, -118.24),
    ('id-003', 'Joes Pizza',   'pizza_restaurant', '789 Elm Blvd', 'Los Angeles', '90013', 'CA', 'https://joespizza.com', NULL,        NULL,         0.70, 34.04, -118.26),
    ('id-004', 'Pho 99',       'vietnamese_restaurant', '321 Vine St', 'Pasadena', '91101', 'CA', NULL,                NULL,          NULL,         0.65, 34.15, -118.14),
    ('id-005', 'Border Grill', 'mexican_restaurant', '555 Grand Ave', 'Los Angeles', '90017', 'CA', 'https://bordergrill.com', '+1-555-0005', NULL, 0.85, 34.05, -118.255)
  ) AS t(id, name, category, address, city, zip, state, website, phone, brand_name, confidence, lat, lng)
) TO '${FIXTURE_PATH}' (FORMAT PARQUET);
  `.trim();

  execSync(`duckdb -c '${sql.replace(/'/g, "'\\''")}'`, { encoding: "utf-8" });
}

if (hasDuckDB) {
  beforeAll(() => {
    createFixtureParquet();
  });

  afterAll(() => {
    try { unlinkSync(FIXTURE_PATH); } catch { /* noop */ }
    try { unlinkSync(FIXTURE_PATH + ".meta.json"); } catch { /* noop */ }
    try { unlinkSync(CACHE_TEST_PATH); } catch { /* noop */ }
    try { unlinkSync(CACHE_TEST_PATH + ".meta.json"); } catch { /* noop */ }
  });
}

// ---------------------------------------------------------------------------
// queryLocalParquet
// ---------------------------------------------------------------------------

describeIfDuckDB("queryLocalParquet", () => {
  it("returns restaurants within the bounding box", async () => {
    // Bbox covers LA downtown area (should include id-001, id-002, id-003, id-005)
    const results = await queryLocalParquet(FIXTURE_PATH, {
      south: 34.03,
      north: 34.07,
      west: -118.27,
      east: -118.23,
    });

    expect(results.length).toBeGreaterThanOrEqual(3);
    const names = results.map((r) => r.name);
    expect(names).toContain("Taco Bell");
    expect(names).toContain("Sushi Gen");
    expect(names).toContain("Joes Pizza");
  });

  it("excludes restaurants outside the bounding box", async () => {
    const results = await queryLocalParquet(FIXTURE_PATH, {
      south: 34.03,
      north: 34.07,
      west: -118.27,
      east: -118.23,
    });

    const names = results.map((r) => r.name);
    // Pho 99 is in Pasadena, outside our bbox
    expect(names).not.toContain("Pho 99");
  });

  it("returns correct field types", async () => {
    const results = await queryLocalParquet(FIXTURE_PATH, {
      south: 34.03,
      north: 34.07,
      west: -118.27,
      east: -118.23,
    });

    const taco = results.find((r) => r.name === "Taco Bell");
    expect(taco).toBeDefined();
    expect(taco!.overtureId).toBe("id-001");
    expect(taco!.category).toBe("fast_food");
    expect(taco!.address).toBe("123 Main St");
    expect(taco!.city).toBe("Los Angeles");
    expect(taco!.zip).toBe("90001");
    expect(taco!.state).toBe("CA");
    expect(taco!.website).toBe("https://tacobell.com");
    expect(taco!.phone).toBe("+1-555-0001");
    expect(taco!.brandName).toBe("Taco Bell");
    expect(taco!.confidence).toBeCloseTo(0.95, 1);
    expect(typeof taco!.lat).toBe("number");
    expect(typeof taco!.lng).toBe("number");
  });

  it("handles null website, phone, brandName correctly", async () => {
    const results = await queryLocalParquet(FIXTURE_PATH, {
      south: 34.03,
      north: 34.07,
      west: -118.27,
      east: -118.23,
    });

    const sushi = results.find((r) => r.name === "Sushi Gen");
    expect(sushi).toBeDefined();
    expect(sushi!.website).toBeNull();
    expect(sushi!.brandName).toBeNull();
  });

  it("returns empty array for bbox with no results", async () => {
    const results = await queryLocalParquet(FIXTURE_PATH, {
      south: 40.0,
      north: 41.0,
      west: -74.0,
      east: -73.0,
    });

    expect(results).toEqual([]);
  });

  it("throws when cache file does not exist", async () => {
    await expect(
      queryLocalParquet("/tmp/nonexistent.parquet", {
        south: 34.0,
        north: 34.1,
        west: -118.3,
        east: -118.2,
      }),
    ).rejects.toThrow("Cache file not found");
  });

  it("produces no duplicate overtureIds", async () => {
    // Query the full extent — all rows
    const results = await queryLocalParquet(FIXTURE_PATH, {
      south: 33.0,
      north: 35.0,
      west: -119.0,
      east: -117.0,
    });

    const ids = results.map((r) => r.overtureId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// isCacheFresh
// ---------------------------------------------------------------------------

describe("isCacheFresh", () => {
  it("returns false when file does not exist", () => {
    expect(isCacheFresh("/tmp/nonexistent-cache.parquet")).toBe(false);
  });
});

describeIfDuckDB("isCacheFresh (with fixture)", () => {
  const TEST_BBOX = { south: 33.9, north: 34.2, west: -118.5, east: -118.1 };

  it("returns true when file was just created (no bbox check)", () => {
    // Our fixture was just created — should be fresh without bbox check
    expect(isCacheFresh(FIXTURE_PATH)).toBe(true);
  });

  it("returns false when file is older than 7 days", () => {
    // Copy fixture to a temp path and backdate it
    execSync(`cp '${FIXTURE_PATH}' '${CACHE_TEST_PATH}'`);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(CACHE_TEST_PATH, eightDaysAgo, eightDaysAgo);

    expect(isCacheFresh(CACHE_TEST_PATH)).toBe(false);
  });

  it("returns false when bbox is requested but no meta file exists", () => {
    expect(isCacheFresh(FIXTURE_PATH, TEST_BBOX)).toBe(false);
  });

  it("returns true when bbox matches meta file", () => {
    execSync(`cp '${FIXTURE_PATH}' '${CACHE_TEST_PATH}'`);
    writeFileSync(CACHE_TEST_PATH + ".meta.json", JSON.stringify(TEST_BBOX), "utf-8");

    expect(isCacheFresh(CACHE_TEST_PATH, TEST_BBOX)).toBe(true);
  });

  it("returns false when bbox does not match meta file", () => {
    execSync(`cp '${FIXTURE_PATH}' '${CACHE_TEST_PATH}'`);
    writeFileSync(CACHE_TEST_PATH + ".meta.json", JSON.stringify(TEST_BBOX), "utf-8");

    const differentBbox = { south: 34.0, north: 34.3, west: -118.6, east: -118.2 };
    expect(isCacheFresh(CACHE_TEST_PATH, differentBbox)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildDownloadSQL
// ---------------------------------------------------------------------------

describe("buildDownloadSQL", () => {
  it("constructs correct SQL with bbox values", () => {
    const sql = buildDownloadSQL(
      { south: 33.9, north: 34.2, west: -118.5, east: -118.1 },
      "/tmp/output.parquet",
    );

    expect(sql).toContain("INSTALL spatial");
    expect(sql).toContain("LOAD httpfs");
    expect(sql).toContain("SET s3_region = 'us-west-2'");
    expect(sql).toContain("bbox.xmin BETWEEN -118.5 AND -118.1");
    expect(sql).toContain("bbox.ymin BETWEEN 33.9 AND 34.2");
    expect(sql).toContain("TO '/tmp/output.parquet' (FORMAT PARQUET)");
    expect(sql).toContain("s3://overturemaps-us-west-2");
  });

  it("uses ILIKE pattern to catch all restaurant variants", () => {
    const sql = buildDownloadSQL(
      { south: 33.9, north: 34.2, west: -118.5, east: -118.1 },
      "/tmp/output.parquet",
    );

    // Pattern-based matching catches fast_food_restaurant, chicken_restaurant, etc.
    expect(sql).toContain("ILIKE '%restaurant%'");
    // Excludes non-food restaurant categories
    expect(sql).toContain("NOT LIKE '%equipment%'");
    expect(sql).toContain("NOT LIKE '%wholesale%'");
  });

  it("includes non-restaurant food categories explicitly", () => {
    const sql = buildDownloadSQL(
      { south: 33.9, north: 34.2, west: -118.5, east: -118.1 },
      "/tmp/output.parquet",
    );

    const nonRestaurantFood = [
      "cafe", "coffee_shop", "bakery", "diner", "steakhouse",
      "sandwich_shop", "ice_cream_shop", "juice_bar", "dessert_shop",
      "food_truck", "bar", "gastropub", "pub", "lounge",
    ];

    for (const cat of nonRestaurantFood) {
      expect(sql).toContain(`'${cat}'`);
    }
  });
});

// ---------------------------------------------------------------------------
// buildLocalQuerySQL
// ---------------------------------------------------------------------------

describe("buildLocalQuerySQL", () => {
  it("constructs correct SQL for local query", () => {
    const sql = buildLocalQuerySQL(
      "/tmp/cache.parquet",
      { south: 34.0, north: 34.1, west: -118.3, east: -118.2 },
    );

    expect(sql).toContain("read_parquet('/tmp/cache.parquet')");
    expect(sql).toContain("lat BETWEEN 34 AND 34.1");
    expect(sql).toContain("lng BETWEEN -118.3 AND -118.2");
    expect(sql).toContain("AS overtureId");
    expect(sql).toContain("AS brandName");
  });
});

// ---------------------------------------------------------------------------
// downloadOvertureCache — command construction (mocked)
// ---------------------------------------------------------------------------

describeIfDuckDB("downloadOvertureCache", () => {
  const DOWNLOAD_BBOX = { south: 33.9, north: 34.2, west: -118.5, east: -118.1 };

  beforeEach(() => {
    // Write meta file so isCacheFresh sees matching bbox
    writeFileSync(FIXTURE_PATH + ".meta.json", JSON.stringify(DOWNLOAD_BBOX), "utf-8");
  });

  afterAll(() => {
    try { unlinkSync(FIXTURE_PATH + ".meta.json"); } catch { /* noop */ }
  });

  it("skips download when cache is fresh", async () => {
    const result = await downloadOvertureCache(DOWNLOAD_BBOX, FIXTURE_PATH);
    expect(result).toBe(FIXTURE_PATH);
  });

  it("returns absolute path", async () => {
    const result = await downloadOvertureCache(DOWNLOAD_BBOX, FIXTURE_PATH);
    expect(result).toMatch(/^\//); // absolute path starts with /
  });
});
