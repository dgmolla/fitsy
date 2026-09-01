import { NextRequest, NextResponse } from "next/server";
import { getRestaurantMenu } from "@/lib/restaurantService";
import { optionalSubscription } from "@/lib/subscription";
import type { MenuApiResponse } from "@fitsy/shared";

// Free-sample size for an unentitled caller — enough to feel like a real
// look at the menu (with real macro numbers, never fake precision) without
// giving away the full paid asset. Mirrors the restaurant-list teaser: real
// data, just less of it.
const FREE_SAMPLE_ITEM_COUNT = 3;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<MenuApiResponse>> {
  // Same optional-auth pattern as GET /api/restaurants — an unentitled caller
  // gets a truncated `locked: true` response instead of being turned away, so
  // the onboarding teaser and the lapsed-subscriber flow can offer one real
  // (partial) restaurant detail view before routing to the paywall.
  const { entitled } = await optionalSubscription(request);

  const { id } = await params;

  try {
    const menu = await getRestaurantMenu(id);

    if (!menu) {
      return NextResponse.json(
        { error: "Restaurant not found" } as never,
        { status: 404 },
      );
    }

    const data = entitled
      ? menu
      : { ...menu, locked: true, menuItems: menu.menuItems.slice(0, FREE_SAMPLE_ITEM_COUNT) };

    return NextResponse.json({ data }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" } as never,
      { status: 500 },
    );
  }
}
