import { Prisma, type PrismaClient } from "@prisma/client";
import type { MenuResponse } from "@fitsy/shared";
import { macroScoreSumSql } from "./macroScoreSql";
import { macroWinnerSqlOrder } from "@fitsy/shared";
import type { MacroTargets } from "@fitsy/shared";

export interface MenuPageOptions { targets?: MacroTargets; cursor?: string; limit?: number; selectedItemId?: string }
interface MenuRow {
  id: string; name: string; description: string | null; category: string | null; price: number | null;
  calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null; hadPhoto: boolean | null; estimatedAt: Date | null;
  score: number; cursorScore: string;
}
const targetKey = (restaurantId: string, options: MenuPageOptions) => JSON.stringify([restaurantId, options.targets?.calories ?? null, options.targets?.proteinG ?? null,
  options.targets?.carbsG ?? null, options.targets?.fatG ?? null, options.selectedItemId ?? null]);
function decode(raw: string, key: string): { id: string; score: string } {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { id: string; score: string; key: string };
    if (typeof c.id === "string" && typeof c.score === "string" && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(c.score)
      && Number.isFinite(Number(c.score)) && c.key === key) return c;
  } catch { /* fall through */ }
  throw new Error("Invalid menu cursor");
}
/** Bound transfer per request, never discard items before ordering by the active match. */
export async function getMenuPage(prisma: Pick<PrismaClient, "restaurant" | "$queryRaw">, restaurantId: string, options: MenuPageOptions = {}): Promise<MenuResponse | null> {
  const limit = Math.min(250, Math.max(1, options.limit ?? 200));
  const key = targetKey(restaurantId, options), cursor = options.cursor ? decode(options.cursor, key) : null;
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId },
    select: { id: true, name: true, rating: true, userRatingCount: true, _count: { select: { menuItems: true } } } });
  if (!restaurant) return null;
  const score = Prisma.sql`CASE WHEN m.id = ${options.selectedItemId ?? null} THEN -1::double precision
    WHEN m.calories IS NULL OR m."proteinG" IS NULL OR m."carbsG" IS NULL OR m."fatG" IS NULL THEN 1e100::double precision
    ELSE ${macroScoreSumSql(options.targets ?? {})} END`;
  const after = cursor ? Prisma.sql`WHERE (score, id) > (${cursor.score}::double precision, ${cursor.id}::text)` : Prisma.empty;
  const rows = await prisma.$queryRaw<MenuRow[]>`
    WITH scored AS MATERIALIZED (
      SELECT m.*, ${score} AS score
      FROM "MenuItem" m WHERE m."restaurantId" = ${restaurantId}
    ), page AS MATERIALIZED (
      SELECT * FROM scored ${after} ORDER BY score, id LIMIT ${limit + 1}
    )
    SELECT page.*, page.score::text AS "cursorScore", e.confidence, e."hadPhoto", e."estimatedAt"
    FROM page LEFT JOIN LATERAL (
      SELECT e.confidence, e."hadPhoto", e."estimatedAt" FROM "MacroEstimate" e
      WHERE e."menuItemId" = page.id ORDER BY ${Prisma.raw(macroWinnerSqlOrder("e"))} LIMIT 1
    ) e ON true ORDER BY page.score, page.id
  `;
  const page = rows.slice(0, limit), last = page.at(-1);
  return { restaurantId, restaurantName: restaurant.name, locked: false,
    ...(restaurant.rating !== null ? { rating: restaurant.rating } : {}),
    ...(restaurant.userRatingCount !== null ? { userRatingCount: restaurant.userRatingCount } : {}),
    totalItemCount: restaurant._count.menuItems,
    // Keep Postgres' float text: Prisma's JSON number transport can move a
    // value by one ULP and skip/repeat tied rows on the next page.
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ id: last.id, score: last.cursorScore, key })).toString("base64url") : null,
    menuItems: page.map(item => ({ id: item.id, name: item.name,
      ...(item.description !== null ? { description: item.description } : {}),
      ...(item.category !== null ? { category: item.category } : {}),
      ...(item.price !== null ? { price: item.price } : {}),
      macros: item.calories !== null && item.proteinG !== null && item.carbsG !== null && item.fatG !== null
        ? { calories: item.calories, proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG,
          confidence: item.confidence ?? "LOW", hadPhoto: item.hadPhoto ?? false,
          estimatedAt: item.estimatedAt?.toISOString() ?? "" } : null,
    })) };
}
