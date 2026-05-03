import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/restaurantService";

// ─── POST /api/user/push-token ───────────────────────────────────────────────
//
// Stores an Expo push token for the authenticated user. Frontend (S-226)
// captures the token after the user grants notification permission and
// posts it here. The column is nullable; calling this endpoint with a new
// token simply overwrites the previous value — no rotation logic yet.
//
// Idempotent: re-registering with the same (or different) token from the
// same user just overwrites — Prisma `update` on a unique key is a no-op
// when the value is unchanged. Latest token wins.
//
// Body: { token: string }
// Response: { ok: true } on success.

// Expo push tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`.
// We don't strictly validate the format here — Expo is the source of truth
// for what's a valid token, and a too-strict regex would silently reject
// future Expo formats. We do enforce a sane length cap to prevent obvious
// abuse (multi-MB strings).
const MAX_PUSH_TOKEN_LENGTH = 512;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Request body required" },
      { status: 400 },
    );
  }

  const { token } = body as { token?: unknown };

  if (typeof token !== "string" || token.length === 0) {
    return NextResponse.json(
      { error: "token must be a non-empty string" },
      { status: 400 },
    );
  }

  if (token.length > MAX_PUSH_TOKEN_LENGTH) {
    return NextResponse.json(
      { error: `token must be at most ${MAX_PUSH_TOKEN_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    await prisma.user.update({
      where: { id: auth.sub },
      data: { pushToken: token },
    });
  } catch (err) {
    console.error("[POST /api/user/push-token] DB update failed:", err);
    return NextResponse.json(
      { error: "Failed to save push token" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
