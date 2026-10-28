import { withApiTelemetry } from '@/lib/apiTelemetry';
import { parseRequestInput } from "@/lib/requestInput";
import { appleAuthSchema, AUTH_BODY_MAX_BYTES, AUTH_INPUT_ERROR, providerDisplayName } from "@/lib/authInput";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseClient } from "@/lib/supabase";
import { authLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { trustedClientIp } from "@/lib/clientIp";
import type { AppleAuthResponse } from "@fitsy/shared";

async function handlePOST(
  request: NextRequest,
): Promise<NextResponse<AppleAuthResponse | { error: string }>> {

  // ─── Rate limiting ───────────────────────────────────────────────────────────

  const rateResult = await authLimiter.check(trustedClientIp(request));
  if (!rateResult.ok) return rateLimitResponse(rateResult, 'Too many requests - please try again later');

  const input = await parseRequestInput(request, appleAuthSchema, AUTH_BODY_MAX_BYTES, AUTH_INPUT_ERROR);
  if (input instanceof NextResponse) return input;
  const { identityToken, nonce, fullName } = input;

  try {
    // ─── Sign in via Supabase ────────────────────────────────────────────────────

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: identityToken,
      nonce,
    });

    if (error && (error.status ?? 0) >= 500) {
      return NextResponse.json({ error: 'Authentication provider unavailable' }, { status: 503 });
    }
    if (error || !data.session || !data.user) {
      return NextResponse.json(
        { error: "Invalid identity token" },
        { status: 401 },
      );
    }

    // Prefer fullName from request (Apple only sends it on first sign-in)
    const derivedName =
      fullName?.givenName || fullName?.familyName
        ? [fullName?.givenName, fullName?.familyName].filter(Boolean).join(" ")
        : providerDisplayName(data.user.user_metadata?.["name"]);

    // ─── Upsert profile in our DB ────────────────────────────────────────────────

    const email = data.user.email;
    if (!email) {
      return NextResponse.json(
        { error: "Apple account has no email" },
        { status: 400 },
      );
    }

    const { isNewUser, user } = await prisma.$transaction(async (tx) => {
      let existingUser = await tx.user.findUnique({
        where: { id: data.user.id },
        select: { id: true },
      });

      // If no user with this Supabase ID, check if one exists with the same email
      // (e.g. previously registered via email/password with a different auth provider).
      // Runs inside a transaction to prevent a race between the existence check and the update.
      if (!existingUser) {
        const userByEmail = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (userByEmail) {
          await tx.user.update({
            where: { email },
            data: { id: data.user.id },
          });
          existingUser = { id: data.user.id };
        }
      }

      const isNewUser = !existingUser;

      const user = await tx.user.upsert({
        where: { id: data.user.id },
        update: {},
        create: {
          id: data.user.id,
          email,
          name: derivedName ?? null,
        },
        select: { id: true, email: true, name: true },
      });

      return { isNewUser, user };
    });

    return NextResponse.json(
      {
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: { id: user.id, email: user.email, name: user.name },
        isNewUser,
      },
      { status: 200 },
    );
  } catch {
    console.error("[auth/apple] request_failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiTelemetry('POST', '/api/auth/apple', handlePOST);
