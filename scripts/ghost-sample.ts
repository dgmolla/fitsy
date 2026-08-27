/**
 * One-off: pull a small mixed sample of restaurants with in-DB "ghost kitchen"
 * signals so we can validate detection heuristics by hand (incl. web search).
 * Not part of the pipeline — safe to delete.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.restaurant.count();

  // Address clustering: ghost kitchens / virtual brands cluster many "stores"
  // at one commissary address. Pull the worst offenders.
  const clustered = await prisma.$queryRaw<
    { address: string; n: bigint }[]
  >`SELECT address, COUNT(*) n FROM "Restaurant" GROUP BY address HAVING COUNT(*) > 3 ORDER BY n DESC LIMIT 10`;

  // Build a deliberately mixed sample:
  //  - some with no rating / no reviews (ghost-suspect)
  //  - some highly-rated with many reviews (real-suspect)
  //  - some from the most-clustered addresses
  const noReviews = await prisma.restaurant.findMany({
    where: { OR: [{ userRatingCount: null }, { userRatingCount: { lt: 5 } }] },
    take: 6,
    select: sel(),
  });
  const wellReviewed = await prisma.restaurant.findMany({
    where: { userRatingCount: { gte: 200 } },
    take: 5,
    select: sel(),
  });
  const topClusterAddr = clustered[0]?.address;
  const fromCluster = topClusterAddr
    ? await prisma.restaurant.findMany({
        where: { address: topClusterAddr },
        take: 5,
        select: sel(),
      })
    : [];

  // menu item counts for the sample — one grouped query, not N concurrent ones
  const sample = dedupe([...noReviews, ...wellReviewed, ...fromCluster]);
  const ids = sample.map((r) => r.id);
  const miGroups = await prisma.menuItem.groupBy({
    by: ['restaurantId'],
    where: { restaurantId: { in: ids } },
    _count: { _all: true },
  });
  const miCount = new Map(miGroups.map((g) => [g.restaurantId, g._count._all]));

  const addrs = Array.from(new Set(sample.map((r) => r.address)));
  const addrGroups = await prisma.restaurant.groupBy({
    by: ['address'],
    where: { address: { in: addrs } },
    _count: { _all: true },
  });
  const addrCount = new Map(addrGroups.map((g) => [g.address, g._count._all]));

  const withCounts = sample.map((r) => ({
    ...r,
    menuItems: miCount.get(r.id) ?? 0,
    sameAddrCount: addrCount.get(r.address) ?? 1,
  }));

  console.log(JSON.stringify({ total, clustered: clustered.map(c => ({ address: c.address, n: Number(c.n) })), sample: withCounts }, null, 2));
}

function sel() {
  return {
    id: true, name: true, brand: true, address: true, lat: true, lng: true,
    rating: true, userRatingCount: true, priceLevel: true, chainFlag: true,
    source: true, cuisineTags: true,
  } as const;
}
function dedupe<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
