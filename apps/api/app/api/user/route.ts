import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseAdmin } from "@/lib/supabase";

// ─── DELETE /api/user ─────────────────────────────────────────────────────────
//
// Permanently deletes the authenticated user's account. Required for App Store
// and GDPR compliance.
//
// Order of operations:
//   1. DB transaction — savedItem, macroTarget, subscription, user (in that order)
//   2. Best-effort Supabase auth admin deleteUser (logged but non-blocking)
//
// DB is the source of truth. A dangling Supabase auth row is recoverable; a
// dangling Prisma user is not. Returns 204 on success.

export async function DELETE(
  request: NextRequest,
): Promise<NextResponse<{ error: string }> | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const userId = auth.sub;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.savedItem.deleteMany({ where: { userId } });
      await tx.macroTarget.deleteMany({ where: { userId } });
      await tx.subscription.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  } catch (err) {
    console.error("[DELETE /api/user] DB transaction failed:", err);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 },
    );
  }

  // Best-effort Supabase auth cleanup. DB is authoritative — if this fails,
  // the user is already gone from our system; log and move on.
  try {
    await getSupabaseAdmin().auth.admin.deleteUser(userId);
  } catch (err) {
    console.error(
      "[DELETE /api/user] Supabase auth deleteUser failed (non-fatal):",
      err,
    );
  }

  return new NextResponse(null, { status: 204 });
}
