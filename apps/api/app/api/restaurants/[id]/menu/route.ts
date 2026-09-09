import { NextRequest, NextResponse } from "next/server";
import { getRestaurantMenu } from "@/lib/restaurantService";
import { optionalSubscription } from "@/lib/subscription";
import type { MenuApiResponse } from "@fitsy/shared";
import { parseMacroTargetParams } from "@/lib/macroTargetParams";

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
  const paramsQuery = request.nextUrl.searchParams;
  const pageSizeRaw = paramsQuery.get("pageSize");
  const pageSize = pageSizeRaw === null ? 200 : Number(pageSizeRaw);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 250) {
    return NextResponse.json({ error: "Invalid page size" } as never, { status: 400 });
  }
  let targets: ReturnType<typeof parseMacroTargetParams>;
  try {
    targets = parseMacroTargetParams(paramsQuery);
  } catch {
    return NextResponse.json({ error: "Invalid macro target" } as never, { status: 400 });
  }

  try {
    const cursor = entitled ? paramsQuery.get("cursor") : null;
    const selectedItemId = entitled ? paramsQuery.get("selectedItemId") : null;
    // A free sample must be stable: selection and target changes cannot be
    // used as alternate pagination to enumerate the rest of the paid menu.
    const menu = await getRestaurantMenu(id, { targets: entitled ? targets : {}, limit: entitled ? pageSize : FREE_SAMPLE_ITEM_COUNT,
      ...(cursor ? { cursor } : {}), ...(selectedItemId ? { selectedItemId } : {}) });

    if (!menu) {
      return NextResponse.json(
        { error: "Restaurant not found" } as never,
        { status: 404 },
      );
    }

    const data = entitled
      ? menu
      : { ...menu, locked: true, nextCursor: null, menuItems: menu.menuItems.slice(0, FREE_SAMPLE_ITEM_COUNT) };

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid menu cursor") return NextResponse.json({ error: error.message } as never, { status: 400 });
    return NextResponse.json(
      { error: "Internal server error" } as never,
      { status: 500 },
    );
  }
}
