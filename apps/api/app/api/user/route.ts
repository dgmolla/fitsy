import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeEmail } from "@/lib/waitlist";

// ─── DELETE /api/user ─────────────────────────────────────────────────────────
//
// Permanently deletes the authenticated user's account. Required for App Store
// and GDPR compliance.
//
// Order of operations:
//   1. DB transaction — savedItem, macroTarget, subscription, the user's
//      onboarding-only waitlist row (if it never opted out), then user
//   2. Best-effort Supabase auth admin deleteUser (logged but non-blocking)
//
// LaunchWaitlist is unlinked (SET NULL), not cascaded: a row that was created
// on fitsy.org, or that carries an email opt-out, is kept as the address-keyed
// suppression record; only a row this account created via "Notify me" and
// never opted out is personal data to remove with the account. Any row that
// survives is stripped of the coarse location the account supplied, so what
// remains is the email address and the opt-out, nothing else. The
// MarketingSend ledger (send history by address) is purged too, unless a
// waitlist row for the address survives: then the address is still a
// legitimate recipient and its history still prevents double sends.
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
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      const email = user ? normalizeEmail(user.email) : null;
      await tx.savedItem.deleteMany({ where: { userId } });
      await tx.macroTarget.deleteMany({ where: { userId } });
      await tx.subscription.deleteMany({ where: { userId } });
      await tx.launchWaitlist.deleteMany({
        where: { userId, source: "onboarding", emailOptOutAt: null },
      });
      await tx.launchWaitlist.updateMany({
        where: { userId },
        data: { lat: null, lng: null, city: null },
      });
      if (email) {
        // Retention is for a website signup in its own right; an opted-out
        // onboarding row that survives is only a suppression record.
        const websiteRow = await tx.launchWaitlist.count({ where: { email, source: "web" } });
        if (websiteRow === 0) await tx.marketingSend.deleteMany({ where: { email } });
      }
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
