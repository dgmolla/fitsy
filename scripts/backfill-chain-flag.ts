/**
 * One-shot backfill: set chainFlag = true for restaurants whose menu items
 * have FatSecret-sourced macro estimates (indicating chain data).
 *
 * Usage:
 *   npx tsx scripts/backfill-chain-flag.ts [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const directUrl = process.env["POSTGRES_URL_NON_POOLING"];
  if (!directUrl) throw new Error("POSTGRES_URL_NON_POOLING is required");

  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

  try {
    // Preview: count how many restaurants will be flipped.
    const preview = await prisma.$queryRawUnsafe<{ cnt: number }[]>(`
      SELECT COUNT(DISTINCT r.id)::int AS cnt
      FROM "Restaurant" r
      JOIN "MenuItem" mi ON mi."restaurantId" = r.id
      JOIN "MacroEstimate" me ON me."menuItemId" = mi.id
      WHERE me.source = 'fatsecret' AND r."chainFlag" = false
    `);
    const toFlip = preview[0]?.cnt ?? 0;

    const totalRestaurants = await prisma.restaurant.count();
    console.log(`Total restaurants: ${totalRestaurants}`);
    console.log(`Restaurants to set chainFlag=true: ${toFlip}`);

    if (dryRun) {
      console.log("[dry-run] No changes made.");
      return;
    }

    if (toFlip === 0) {
      console.log("Nothing to backfill.");
      return;
    }

    // Set chainFlag = true where any macro came from fatsecret.
    const updated = await prisma.$executeRawUnsafe(`
      UPDATE "Restaurant" r
      SET "chainFlag" = true, "updatedAt" = now()
      WHERE r."chainFlag" = false
        AND EXISTS (
          SELECT 1 FROM "MenuItem" mi
          JOIN "MacroEstimate" me ON me."menuItemId" = mi.id
          WHERE mi."restaurantId" = r.id AND me.source = 'fatsecret'
        )
    `);
    console.log(`Updated ${updated} restaurants to chainFlag=true.`);

    // Verify final counts.
    const chains = await prisma.restaurant.count({ where: { chainFlag: true } });
    const indiePercent = Math.round(((totalRestaurants - chains) / totalRestaurants) * 100);
    console.log(`Final: ${chains} chains, ${totalRestaurants - chains} indie (${indiePercent}%)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
