/**
 * Overture Maps Discovery Service (S-136)
 *
 * Replaces Google Places for restaurant discovery.
 * Uses DuckDB to query Overture Maps GeoParquet data on S3,
 * caches results locally, and provides fast local queries
 * for per-hex processing.
 *
 * Overture Maps: free, unlimited, no API key required.
 * DuckDB: installed via homebrew, queries parquet natively.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, statSync } from "fs";
import { dirname, resolve } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OvertureRestaurant {
  overtureId: string;
  name: string;
  category: string;
  address: string;
  city: string;
  zip: string;
  state: string;
  website: string | null;
  phone: string | null;
  brandName: string | null;
  confidence: number;
  lat: number;
  lng: number;
}

export interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_PATH = resolve(__dirname, "cache/overture-discovery.parquet");

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const OVERTURE_RELEASE = "2026-03-18.0";
const OVERTURE_S3_PATH =
  `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=places/type=place/*`;

/** All food-related Overture categories we care about. */
const FOOD_CATEGORIES = [
  "restaurant",
  "fast_food",
  "cafe",
  "pizza_restaurant",
  "mexican_restaurant",
  "chinese_restaurant",
  "japanese_restaurant",
  "thai_restaurant",
  "italian_restaurant",
  "indian_restaurant",
  "korean_restaurant",
  "vietnamese_restaurant",
  "sushi_restaurant",
  "burger_restaurant",
  "seafood_restaurant",
  "american_restaurant",
  "mediterranean_restaurant",
  "greek_restaurant",
  "french_restaurant",
  "middle_eastern_restaurant",
  "asian_restaurant",
  "bakery",
  "bar",
  "diner",
  "steakhouse",
  "barbecue_restaurant",
  "noodle_restaurant",
  "ramen_restaurant",
  "taco_restaurant",
  "sandwich_shop",
  "ice_cream_shop",
  "juice_bar",
  "coffee_shop",
  "dessert_shop",
] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function categoryInClause(): string {
  return FOOD_CATEGORIES.map((c) => `'${c}'`).join(", ");
}

/**
 * Build the DuckDB SQL that downloads Overture data for a bounding box
 * and writes it to a local parquet file.
 */
export function buildDownloadSQL(bbox: BoundingBox, outputPath: string): string {
  return `
INSTALL spatial; LOAD spatial;
INSTALL httpfs;  LOAD httpfs;
SET s3_region = 'us-west-2';

COPY (
  SELECT
    id,
    names.primary              AS name,
    categories.primary         AS category,
    addresses[1].freeform      AS address,
    addresses[1].locality      AS city,
    addresses[1].postcode      AS zip,
    addresses[1].region        AS state,
    websites[1]                AS website,
    phones[1]                  AS phone,
    brand.names.primary        AS brand_name,
    confidence,
    ST_Y(geometry)::DOUBLE     AS lat,
    ST_X(geometry)::DOUBLE     AS lng
  FROM read_parquet(
    '${OVERTURE_S3_PATH}',
    filename=true, hive_partitioning=1
  )
  WHERE
    bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east}
    AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
    AND categories.primary IN (${categoryInClause()})
) TO '${outputPath}' (FORMAT PARQUET);
`.trim();
}

/**
 * Build the DuckDB SQL that queries a local parquet file for restaurants
 * within a bounding box.
 */
export function buildLocalQuerySQL(cachePath: string, bbox: BoundingBox): string {
  return `
SELECT
  id          AS overtureId,
  name,
  category,
  address,
  city,
  zip,
  state,
  website,
  phone,
  brand_name  AS brandName,
  confidence,
  lat,
  lng
FROM read_parquet('${cachePath}')
WHERE
  lat BETWEEN ${bbox.south} AND ${bbox.north}
  AND lng BETWEEN ${bbox.west} AND ${bbox.east};
`.trim();
}

/**
 * Returns true if `cachePath` exists and was modified less than 7 days ago.
 */
export function isCacheFresh(cachePath: string): boolean {
  if (!existsSync(cachePath)) return false;
  const mtime = statSync(cachePath).mtimeMs;
  return Date.now() - mtime < CACHE_MAX_AGE_MS;
}

/**
 * Execute a DuckDB command and return raw stdout.
 * Throws on non-zero exit.
 */
function runDuckDB(sql: string, json: boolean = false): string {
  const flags = json ? "-json" : "";
  // Use -c to pass SQL inline. DuckDB needs no database file for this.
  const cmd = `duckdb ${flags} -c ${escapeShellArg(sql)}`;
  return execSync(cmd, {
    encoding: "utf-8",
    maxBuffer: 100 * 1024 * 1024, // 100 MB — large result sets
    timeout: 10 * 60 * 1000,      // 10 min for S3 downloads
  });
}

/** Shell-escape a single argument (wrap in single quotes, escape internal quotes). */
function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download Overture Maps data for a bounding box to a local parquet cache.
 *
 * If the cache file already exists and is less than 7 days old, this is a
 * no-op and the existing path is returned immediately.
 *
 * @returns Absolute path to the local parquet file.
 */
export async function downloadOvertureCache(
  bbox: BoundingBox,
  cachePath: string = DEFAULT_CACHE_PATH,
): Promise<string> {
  const absPath = resolve(cachePath);

  if (isCacheFresh(absPath)) {
    console.log(`[overture] Cache fresh, reusing: ${absPath}`);
    return absPath;
  }

  // Ensure parent directory exists
  const dir = dirname(absPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sql = buildDownloadSQL(bbox, absPath);
  console.log(`[overture] Downloading Overture data for bbox…`);
  console.log(`[overture]   south=${bbox.south} north=${bbox.north} west=${bbox.west} east=${bbox.east}`);
  runDuckDB(sql);
  console.log(`[overture] Saved to: ${absPath}`);

  return absPath;
}

/**
 * Query a local parquet cache for restaurants within a bounding box.
 *
 * This is extremely fast (~0.03s) since it reads a local file, not S3.
 * Designed for per-hex processing where you query a subset of the
 * full cached dataset.
 *
 * @returns Array of restaurants, deduplicated by overtureId.
 */
export async function queryLocalParquet(
  cachePath: string,
  bbox: BoundingBox,
): Promise<OvertureRestaurant[]> {
  const absPath = resolve(cachePath);

  if (!existsSync(absPath)) {
    throw new Error(`Cache file not found: ${absPath}. Run downloadOvertureCache first.`);
  }

  const sql = buildLocalQuerySQL(absPath, bbox);
  const raw = runDuckDB(sql, true);

  // DuckDB -json returns a JSON array. Empty result → empty string or "[]".
  if (!raw.trim() || raw.trim() === "[]") return [];

  const rows: Array<Record<string, unknown>> = JSON.parse(raw);

  // Map to typed interface and deduplicate
  const seen = new Set<string>();
  const results: OvertureRestaurant[] = [];

  for (const row of rows) {
    const id = String(row["overtureId"] ?? "");
    if (seen.has(id)) continue;
    seen.add(id);

    results.push({
      overtureId: id,
      name: String(row["name"] ?? ""),
      category: String(row["category"] ?? ""),
      address: String(row["address"] ?? ""),
      city: String(row["city"] ?? ""),
      zip: String(row["zip"] ?? ""),
      state: String(row["state"] ?? ""),
      website: row["website"] != null ? String(row["website"]) : null,
      phone: row["phone"] != null ? String(row["phone"]) : null,
      brandName: row["brandName"] != null ? String(row["brandName"]) : null,
      confidence: Number(row["confidence"] ?? 0),
      lat: Number(row["lat"] ?? 0),
      lng: Number(row["lng"] ?? 0),
    });
  }

  return results;
}
