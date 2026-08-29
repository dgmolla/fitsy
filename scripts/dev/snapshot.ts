/**
 * Copy a real-shaped subset of production restaurant data into the dev DB.
 *
 * Reads from prod over a READ-ONLY session (guard.ts forces
 * default_transaction_read_only), writes to the dev DB (guard.ts refuses prod
 * as a target). Copies, in dependency order:
 *
 *   Brand -> ChainItem -> Restaurant -> MenuItem -> MacroEstimate
 *
 * Selection: the N highest-rated restaurants within RADIUS_MI of CENTER
 * (defaults: 500, 3 miles, downtown LA). No user data ever leaves prod.
 *
 * Idempotent: createMany with skipDuplicates; re-running refreshes new rows.
 *
 * Env:
 *   PROD_DATABASE_URL          prod POSTGRES_URL_NON_POOLING (source)
 *   POSTGRES_URL_NON_POOLING   dev direct URL (target)
 * Flags:
 *   --limit=500 --radius-mi=3 --lat=34.0522 --lng=-118.2437
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { assertNotProd, prodReadOnlyUrl, applyReadOnly, hostOf } from "./lib/guard";

function flag(name: string, dflt: number): number {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? Number(m.split("=")[1]) : dflt;
}

async function main(): Promise<void> {
  const limit = flag("limit", 500);
  const radiusMi = flag("radius-mi", 3);
  const lat = flag("lat", 34.0522);
  const lng = flag("lng", -118.2437);

  const src = new PrismaClient({ datasources: { db: { url: prodReadOnlyUrl(process.env["PROD_DATABASE_URL"]) } } });
  const dstUrl = assertNotProd(process.env["POSTGRES_URL_NON_POOLING"], "POSTGRES_URL_NON_POOLING");
  const dst = new PrismaClient({ datasources: { db: { url: dstUrl } } });
  console.error(`snapshot prod -> ${hostOf(dstUrl)} | ${limit} restaurants within ${radiusMi}mi of ${lat},${lng}`);

  try {
    await applyReadOnly(src);
    const latDelta = radiusMi / 69;
    const lngDelta = radiusMi / (69 * Math.cos((lat * Math.PI) / 180));
    const restaurants = await src.restaurant.findMany({
      where: { lat: { gte: lat - latDelta, lte: lat + latDelta }, lng: { gte: lng - lngDelta, lte: lng + lngDelta } },
      orderBy: [{ userRatingCount: "desc" }, { rating: "desc" }],
      take: limit,
    });
    const restaurantIds = restaurants.map((r) => r.id);
    const brandIds = [...new Set(restaurants.map((r) => r.brandId).filter((b): b is string => !!b))];

    const brands = brandIds.length ? await src.brand.findMany({ where: { id: { in: brandIds } } }) : [];
    const chainItems = brandIds.length ? await src.chainItem.findMany({ where: { brandId: { in: brandIds } } }) : [];
    const menuItems = await src.menuItem.findMany({ where: { restaurantId: { in: restaurantIds } } });
    const menuItemIds = menuItems.map((m) => m.id);
    const estimates: Awaited<ReturnType<typeof src.macroEstimate.findMany>> = [];
    for (let i = 0; i < menuItemIds.length; i += 5000) {
      estimates.push(...(await src.macroEstimate.findMany({ where: { menuItemId: { in: menuItemIds.slice(i, i + 5000) } } })));
    }
    console.error(`  read: ${brands.length} brands, ${chainItems.length} chain items, ${restaurants.length} restaurants, ${menuItems.length} items, ${estimates.length} estimates`);

    const chunk = async <T,>(rows: T[], write: (batch: T[]) => Promise<unknown>, size = 1000) => {
      for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
    };
    await chunk(brands, (b) => dst.brand.createMany({ data: b, skipDuplicates: true }));
    await chunk(chainItems, (b) => dst.chainItem.createMany({ data: b, skipDuplicates: true }));
    await chunk(restaurants, (b) => dst.restaurant.createMany({ data: b, skipDuplicates: true }));
    await chunk(menuItems, (b) => dst.menuItem.createMany({ data: b, skipDuplicates: true }));
    await chunk(
      estimates.map((e) => ({ ...e, ingredientBreakdown: e.ingredientBreakdown === null ? Prisma.JsonNull : (e.ingredientBreakdown as Prisma.InputJsonValue) })),
      (b) => dst.macroEstimate.createMany({ data: b, skipDuplicates: true }),
    );

    const counts = {
      restaurants: await dst.restaurant.count(),
      menuItems: await dst.menuItem.count(),
      macroEstimates: await dst.macroEstimate.count(),
    };
    console.log(JSON.stringify({ name: "snapshot", status: "pass", target: hostOf(dstUrl), copied: { restaurants: restaurants.length, menuItems: menuItems.length, estimates: estimates.length }, devTotals: counts }));
  } finally {
    await Promise.all([src.$disconnect(), dst.$disconnect()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
