/**
 * Backfill Photos for Restaurants Missing photoUrl
 *
 * Iterates all restaurants where photoUrl IS NULL and attempts to fetch
 * a photo via two sources in priority order:
 *
 *   1. UberEats JSON-LD (free) — discovers the store URL via Brave/Firecrawl,
 *      fetches the page, extracts imageUrl from JSON-LD. Validates geo within
 *      500m so we don't store photos from the wrong location.
 *
 *   2. Google Places API (paid, ~$0.024/restaurant) — Text Search + Photo
 *      Fetch. Validates the closest result is within 50m of the DB lat/lng.
 *
 * Each successful hit updates Restaurant.photoUrl in the DB immediately.
 * At the end, a summary table shows coverage by source.
 *
 * Usage:
 *   cd fitsy
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-photos.ts [--dry-run] [--limit N]
 *
 * Flags:
 *   --dry-run   Fetch photos but do NOT write to DB (reports what would change)
 *   --limit N   Process at most N restaurants (default: all)
 */

import { PrismaClient } from "@prisma/client";
import { UberEatsSource } from "../apps/api/services/menuSources/uberEatsSource.js";
import { fetchGooglePlacesPhoto } from "../apps/api/services/googlePlacesPhoto.js";

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1] ?? "0", 10) : Infinity;

// ─── Stats ────────────────────────────────────────────────────────────────────

interface Stats {
  total: number;
  ueHits: number;
  placesHits: number;
  stillMissing: number;
  errors: number;
}

const stats: Stats = { total: 0, ueHits: 0, placesHits: 0, stillMissing: 0, errors: 0 };

// ─── Per-restaurant detail log ────────────────────────────────────────────────

interface RowResult {
  name: string;
  source: "ubereats" | "places" | "none" | "error";
  photoUrl?: string;
  note?: string;
}
const results: RowResult[] = [];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const missing = await prisma.restaurant.findMany({
      where: { photoUrl: null },
      select: { id: true, name: true, address: true, lat: true, lng: true, menuSourceId: true, chainFlag: true },
      orderBy: { name: "asc" },
      ...(isFinite(LIMIT) ? { take: LIMIT } : {}),
    });

    stats.total = missing.length;
    console.log(`\n[backfill-photos] Found ${missing.length} restaurants missing photoUrl${DRY_RUN ? " (DRY RUN)" : ""}\n`);

    // Shared UberEats source (no pre-known URL, no sitemap index — uses Brave/Firecrawl discovery)
    const ueSource = new UberEatsSource();

    for (const restaurant of missing) {
      const { id, name, address, lat, lng } = restaurant;
      process.stdout.write(`  ${name.padEnd(45)} `);

      let photoUrl: string | null = null;
      let source: RowResult["source"] = "none";

      // ── 1. UberEats JSON-LD (free) ─────────────────────────────────────────
      try {
        photoUrl = await ueSource.lookupPhoto(name, address, { lat, lng });
        if (photoUrl) {
          source = "ubereats";
          stats.ueHits++;
          process.stdout.write(`[UE]     ${photoUrl.slice(0, 60)}…\n`);
        }
      } catch (err) {
        process.stdout.write(`[UE ERR] ${err instanceof Error ? err.message : String(err)}\n`);
        stats.errors++;
        results.push({ name, source: "error", note: String(err) });
        continue;
      }

      // ── 2. Google Places fallback ──────────────────────────────────────────
      if (!photoUrl) {
        try {
          photoUrl = await fetchGooglePlacesPhoto(name, lat, lng);
          if (photoUrl) {
            source = "places";
            stats.placesHits++;
            process.stdout.write(`[GP]     ${photoUrl.slice(0, 60)}…\n`);
          } else {
            process.stdout.write(`[none]\n`);
            stats.stillMissing++;
          }
        } catch (err) {
          process.stdout.write(`[GP ERR] ${err instanceof Error ? err.message : String(err)}\n`);
          stats.errors++;
          results.push({ name, source: "error", note: String(err) });
          continue;
        }
      }

      // ── 3. Persist ─────────────────────────────────────────────────────────
      if (photoUrl && !DRY_RUN) {
        await prisma.restaurant.update({ where: { id }, data: { photoUrl } });
      }

      if (photoUrl) {
        results.push({ name, source, photoUrl });
      } else {
        results.push({ name, source });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await main();

  console.log(`\n${"─".repeat(70)}`);
  console.log(`SUMMARY${DRY_RUN ? " (dry-run — no DB writes)" : ""}`);
  console.log(`${"─".repeat(70)}`);
  console.log(`  Total missing         : ${stats.total}`);
  console.log(`  Found via UberEats    : ${stats.ueHits}  (${pct(stats.ueHits, stats.total)}%)`);
  console.log(`  Found via Google Plcs : ${stats.placesHits}  (${pct(stats.placesHits, stats.total)}%)`);
  console.log(`  Still missing         : ${stats.stillMissing}  (${pct(stats.stillMissing, stats.total)}%)`);
  console.log(`  Errors                : ${stats.errors}`);
  console.log(`${"─".repeat(70)}\n`);

  if (results.filter(r => r.source === "none").length > 0) {
    console.log("Restaurants still missing a photo:");
    results.filter(r => r.source === "none").forEach(r => console.log(`  - ${r.name}`));
    console.log();
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return "—";
  return ((n / total) * 100).toFixed(0);
}

run().catch((err: unknown) => {
  console.error("[backfill-photos] fatal:", err);
  process.exit(1);
});
