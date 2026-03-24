import { NextRequest, NextResponse } from "next/server";
import { getRestaurantMenu } from "@/lib/restaurantService";
import type { MenuApiResponse } from "@fitsy/shared";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<MenuApiResponse>> {
  const { id } = await params;

  try {
    const menu = await getRestaurantMenu(id);

    if (!menu) {
      return NextResponse.json(
        { error: "Restaurant not found" } as never,
        { status: 404 },
      );
    }

    return NextResponse.json({ data: menu }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" } as never,
      { status: 500 },
    );
  }
}
