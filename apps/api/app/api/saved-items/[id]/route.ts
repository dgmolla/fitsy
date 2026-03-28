import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";

// ─── DELETE /api/saved-items/[id] ────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  const userId = auth.sub;
  const { id } = await params;

  try {
    const savedItem = await prisma.savedItem.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!savedItem) {
      return NextResponse.json(
        { error: "Saved item not found" },
        { status: 404 },
      );
    }

    if (savedItem.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.savedItem.delete({ where: { id } });

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
