import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";
import { Prisma } from "@prisma/client";
import { pickWinningEstimate } from "@fitsy/shared";
import type { SavedItemsResponse, SavedItemResponse } from "@fitsy/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSavedItemResponse(item: {
  id: string;
  menuItemId: string | null;
  restaurantId: string | null;
  itemType: string;
  createdAt: Date;
  menuItem: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    price: number | null;
    restaurant: {
      id: string;
      name: string;
      address: string;
    };
    macroEstimates: {
      id: string;
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      confidence: string;
      source: string | null;
      hadPhoto: boolean;
      estimatedAt: Date;
    }[];
  } | null;
}): SavedItemResponse {
  const macroEstimate = item.menuItem
    ? pickWinningEstimate(item.menuItem.macroEstimates)
    : null;

  return {
    id: item.id,
    menuItemId: item.menuItemId ?? "",
    restaurantId: item.restaurantId,
    itemType: item.itemType as "menu_item" | "restaurant",
    createdAt: item.createdAt.toISOString(),
    menuItem: item.menuItem
      ? {
          id: item.menuItem.id,
          name: item.menuItem.name,
          ...(item.menuItem.description != null
            ? { description: item.menuItem.description }
            : {}),
          ...(item.menuItem.category != null
            ? { category: item.menuItem.category }
            : {}),
          ...(item.menuItem.price != null
            ? { price: item.menuItem.price }
            : {}),
          macros: macroEstimate
            ? {
                calories: macroEstimate.calories,
                proteinG: macroEstimate.proteinG,
                carbsG: macroEstimate.carbsG,
                fatG: macroEstimate.fatG,
                confidence: macroEstimate.confidence as
                  | "HIGH"
                  | "MEDIUM"
                  | "LOW",
                hadPhoto: macroEstimate.hadPhoto,
                estimatedAt: macroEstimate.estimatedAt.toISOString(),
              }
            : null,
          restaurant: {
            id: item.menuItem.restaurant.id,
            name: item.menuItem.restaurant.name,
            address: item.menuItem.restaurant.address,
          },
        }
      : null,
  };
}

// ─── GET /api/saved-items ─────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
): Promise<NextResponse<SavedItemsResponse | { error: string }>> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  const userId = auth.sub;
  const { searchParams } = request.nextUrl;

  const cursor = searchParams.get("cursor") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw !== null ? Math.min(Number(limitRaw), 50) : 50;

  try {
    const items = await prisma.savedItem.findMany({
      where: { userId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        menuItem: {
          include: {
            restaurant: {
              select: { id: true, name: true, address: true },
            },
            macroEstimates: {
              select: {
                id: true,
                calories: true,
                proteinG: true,
                carbsG: true,
                fatG: true,
                confidence: true,
                source: true,
                hadPhoto: true,
                estimatedAt: true,
              },
            },
          },
        },
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;

    return NextResponse.json(
      {
        data: page.map(toSavedItemResponse),
        meta: { hasMore, ...(nextCursor ? { cursor: nextCursor } : {}) },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ─── POST /api/saved-items ────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
): Promise<NextResponse<{ data: SavedItemResponse } | { error: string }>> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  const userId = auth.sub;

  let body: { menuItemId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { menuItemId } = body;
  if (typeof menuItemId !== "string" || !menuItemId) {
    return NextResponse.json(
      { error: "menuItemId is required" },
      { status: 400 },
    );
  }

  try {
    // Look up the menuItem to get restaurantId
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, restaurantId: true },
    });

    if (!menuItem) {
      return NextResponse.json(
        { error: "Menu item not found" },
        { status: 404 },
      );
    }

    const include = {
      menuItem: {
        include: {
          restaurant: {
            select: { id: true, name: true, address: true },
          },
          macroEstimates: {
            select: {
              id: true,
              calories: true,
              proteinG: true,
              carbsG: true,
              fatG: true,
              confidence: true,
              source: true,
              hadPhoto: true,
              estimatedAt: true,
            },
          },
        },
      },
    } as const;

    try {
      const savedItem = await prisma.savedItem.create({
        data: {
          userId,
          menuItemId,
          restaurantId: menuItem.restaurantId,
          itemType: "menu_item",
        },
        include,
      });
      return NextResponse.json(
        { data: toSavedItemResponse(savedItem) },
        { status: 201 },
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Already saved — fetch and return existing row
        const existing = await prisma.savedItem.findUniqueOrThrow({
          where: { userId_menuItemId: { userId, menuItemId } },
          include,
        });
        return NextResponse.json(
          { data: toSavedItemResponse(existing) },
          { status: 200 },
        );
      }
      throw err;
    }
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
