/**
 * One-off: test coordinate-clustering as a ghost-kitchen signal.
 * Virtual-brand operators run many "restaurants" from one kitchen → identical
 * lat/lng. Address is empty in this DB, but coords are populated.
 * Safe to delete.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Round to ~11m grid to absorb float noise, then find coords hosting many brands.
  const rows = await prisma.$queryRaw<{ lat: number; lng: number; n: bigint }[]>`
    SELECT ROUND(lat::numeric, 4) lat, ROUND(lng::numeric, 4) lng, COUNT(*) n
    FROM "Restaurant"
    GROUP BY ROUND(lat::numeric, 4), ROUND(lng::numeric, 4)
    HAVING COUNT(*) > 2
    ORDER BY n DESC
    LIMIT 20`;

  // Distribution: how many coords host 1, 2, 3+ brands
  const dist = await prisma.$queryRaw<{ bucket: string; n: bigint }[]>`
    WITH g AS (
      SELECT ROUND(lat::numeric,4) la, ROUND(lng::numeric,4) ln, COUNT(*) c
      FROM "Restaurant" GROUP BY 1,2)
    SELECT CASE WHEN c=1 THEN '1' WHEN c=2 THEN '2' WHEN c<=4 THEN '3-4'
                WHEN c<=8 THEN '5-8' ELSE '9+' END bucket, COUNT(*) n
    FROM g GROUP BY 1 ORDER BY 1`;

  // Sample the brand names at the densest cluster
  const top = rows[0];
  let names: string[] = [];
  if (top) {
    const r = await prisma.$queryRaw<{ name: string; rating: number | null; userRatingCount: number | null }[]>`
      SELECT name, rating, "userRatingCount" FROM "Restaurant"
      WHERE ROUND(lat::numeric,4) = ${top.lat} AND ROUND(lng::numeric,4) = ${top.lng}
      ORDER BY name LIMIT 40`;
    names = r.map((x) => `${x.name} [r=${x.rating ?? '·'} n=${x.userRatingCount ?? '·'}]`);
  }

  console.log(JSON.stringify({
    distribution: dist.map((d) => ({ brandsPerCoord: d.bucket, coords: Number(d.n) })),
    densestClusters: rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), brands: Number(r.n) })),
    densestClusterNames: names,
  }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
