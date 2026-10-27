import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";

interface StatsResponse {
  totalDishes: number;
  indiePercent: number;
}

/**
 * GET /api/restaurants/stats
 *
 * Authenticated aggregate stats for the onboarding data-scale screen.
 */
export async function GET(request: NextRequest): Promise<NextResponse<StatsResponse> | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const [totalDishes, totalRestaurants, chainCount] = await Promise.all([
    prisma.menuItem.count({
      where: { retiredAt: null, macroEstimates: { some: {} } },
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
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
