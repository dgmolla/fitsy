/**
 * Phase 1 — coverage report in RESTAURANT (location) + ITEM terms, by route, plus the
 * fallback-tier source split (fatsecret/haiku) for everything not officially extracted.
 *   npx tsx --env-file=.env.local scripts/phase1-coverage-report.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const p = new PrismaClient();

async function main() {
  const cov = JSON.parse(readFileSync("scripts/phase1-out/run/_coverage.json", "utf8"));
  const results: any[] = cov.results;
  const officialSlugs = results.filter((r) => r.status === "official").map((r) => r.slug);
  const spaSlugs = results.filter((r) => r.status.startsWith("deferred") || r.status === "error").map((r) => r.slug);
  // route per official slug
  const routeBySlug = new Map(results.filter((r) => r.status === "official").map((r) => [r.slug, r.route]));

  // --- totals ---
  const totalRest = await p.restaurant.count();
  const chainRest = await p.restaurant.count({ where: { brandId: { not: null } } });
  const totalItems = await p.menuItem.count();

  // --- restaurants + items covered by official extraction, by route ---
  const offRows = await p.$queryRaw<{ route: string; restaurants: bigint; items: bigint }[]>`
    SELECT b.slug, count(DISTINCT r.id) AS restaurants, count(mi.id) AS items
    FROM "Brand" b JOIN "Restaurant" r ON r."brandId" = b.id
    LEFT JOIN "MenuItem" mi ON mi."restaurantId" = r.id
    WHERE b.slug = ANY(${officialSlugs})
    GROUP BY b.slug` as any;
  const byRoute: Record<string, { rest: number; items: number; brands: number }> = {};
  let offRest = 0, offItems = 0;
  for (const row of offRows as any[]) {
    const route = routeBySlug.get(row.slug) ?? "?";
    byRoute[route] ??= { rest: 0, items: 0, brands: 0 };
    byRoute[route].rest += Number(row.restaurants); byRoute[route].items += Number(row.items); byRoute[route].brands++;
    offRest += Number(row.restaurants); offItems += Number(row.items);
  }

  // restaurants under deferred-SPA brands (→ fallback)
  const spaRest = await p.restaurant.count({ where: { brandRef: { slug: { in: spaSlugs } } } });

  // --- fallback-tier source split: MacroEstimates NOT under an official brand ---
  const srcAll = await p.macroEstimate.groupBy({ by: ["source"], _count: { _all: true } });
  const srcFallback = await p.$queryRaw<{ source: string; n: bigint }[]>`
    SELECT me.source, count(*) AS n
    FROM "MacroEstimate" me
    JOIN "MenuItem" mi ON me."menuItemId" = mi.id
    JOIN "Restaurant" r ON mi."restaurantId" = r.id
    LEFT JOIN "Brand" b ON r."brandId" = b.id
    WHERE (b.slug IS NULL OR b.slug <> ALL(${officialSlugs}))
    GROUP BY me.source` as any;

  // --- report ---
  console.log(`\n=== RESTAURANT (location) coverage ===`);
  console.log(`  total restaurants            : ${totalRest}`);
  console.log(`  chain locations (brandId set): ${chainRest}   indie/no-brand: ${totalRest - chainRest}`);
  console.log(`\n  OFFICIAL-extracted (Phase 1), by route:`);
  for (const [route, v] of Object.entries(byRoute))
    console.log(`    ${route.padEnd(15)} ${v.brands} brands → ${v.rest} restaurants, ${v.items} menu items`);
  console.log(`    ${"TOTAL official".padEnd(15)} ${officialSlugs.length} brands → ${offRest} restaurants, ${offItems} menu items`);
  console.log(`\n  FALLBACK tier (FatSecret→Haiku): ${totalRest - offRest} restaurants (SPA chains + no-official + indie)`);
  console.log(`    (of which SPA/deferred chain locations: ${spaRest})`);

  console.log(`\n=== MacroEstimate source split ===`);
  const fmt = (rows: any[], key = "_count") => rows.map((r: any) => `${r.source}=${Number(r.n ?? r._count?._all)}`).join("  ");
  console.log(`  ALL estimates       : ${srcAll.map((s) => `${s.source}=${s._count._all}`).join("  ")}`);
  console.log(`  FALLBACK subset only: ${(srcFallback as any[]).map((s) => `${s.source}=${Number(s.n)}`).join("  ")}`);
  console.log(`  (official brands' ${offItems} items would flip to source=official on M6 landing)`);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
