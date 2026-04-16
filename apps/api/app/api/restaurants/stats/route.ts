import { NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";

interface StatsResponse {
  totalDishes: number;
  indiePercent: number;
}

/**
 * GET /api/restaurants/stats
 *
 * Public — returns aggregate stats for the onboarding data-scale screen.
 * Cached for 1 hour since these numbers change infrequently.
 */
export async function GET(): Promise<NextResponse<StatsResponse>> {
  const [totalDishes, totalRestaurants, chainCount] = await Promise.all([
    prisma.menuItem.count({
      where: { macroEstimates: { some: {} } },
    }),
    prisma.restaurant.count(),
    prisma.restaurant.count({ where: { chainFlag: true } }),
  ]);

  const indiePercent =
    totalRestaurants > 0
      ? Math.round(((totalRestaurants - chainCount) / totalRestaurants) * 100)
      : 0;

  return NextResponse.json(
    { totalDishes, indiePercent },
    {
      status: 200,
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    },
  );
}
