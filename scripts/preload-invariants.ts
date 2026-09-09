import type { Prisma } from "@prisma/client";
import type { HexRestaurantData } from "./hex-persist";
export async function validateHexInTx(
  tx: Prisma.TransactionClient,
  restaurants: HexRestaurantData[],
): Promise<void> {
  if (restaurants.length === 0) return;
  const ids = restaurants.map((r) => r.restaurantId);
  const rows = await tx.$queryRaw<
    { restaurantId: string; itemCount: bigint; macroCount: bigint }[]
  >`
    SELECT r.id AS "restaurantId",
           COUNT(DISTINCT mi.id)::bigint AS "itemCount",
           COUNT(DISTINCT me."menuItemId")::bigint AS "macroCount"
    FROM "Restaurant" r
    LEFT JOIN "MenuItem" mi ON mi."restaurantId" = r.id
    LEFT JOIN "MacroEstimate" me ON me."menuItemId" = mi.id
    WHERE r.id = ANY(${ids}::text[])
    GROUP BY r.id
  `;
  const byId = new Map(rows.map((r) => [r.restaurantId, r]));
  const failures: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      failures.push(`${id}: row missing from invariant query`);
      continue;
    }
    const items = Number(row.itemCount);
    const macros = Number(row.macroCount);
    if (items === 0) failures.push(`${id}: items=0`);
    else if (items !== macros) failures.push(`${id}: items=${items} macros=${macros}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `hex invariant check failed (${failures.length}/${ids.length} restaurants): ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "…" : ""}`,
    );
  }
}

