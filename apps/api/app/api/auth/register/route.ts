import { withApiTelemetry } from '@/lib/apiTelemetry';
import { parseRequestInput } from "@/lib/requestInput";
import { registerSchema, AUTH_BODY_MAX_BYTES, AUTH_INPUT_ERROR } from "@/lib/authInput";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseAdmin, getSupabaseClient } from "@/lib/supabase";
import { sendWelcomeEmail } from "@/services/emailService";
import { authLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { trustedClientIp } from "@/lib/clientIp";
import { canRegisterWithPassword } from "@/lib/reviewerAccess";
import type { AuthApiResponse } from "@fitsy/shared";

async function handlePOST(
  request: NextRequest,
): Promise<NextResponse<AuthApiResponse | { error: string }>> {
  if (!canRegisterWithPassword()) {
    return NextResponse.json({ error: "Use Apple or Google to create an account" }, { status: 403 });
  }
  // ─── Rate limiting ───────────────────────────────────────────────────────────

  const rateResult = await authLimiter.check(trustedClientIp(request));
  if (!rateResult.ok) return rateLimitResponse(rateResult, 'Too many requests - please try again later');

  const input = await parseRequestInput(request, registerSchema, AUTH_BODY_MAX_BYTES, AUTH_INPUT_ERROR);
  if (input instanceof NextResponse) return input;
  const { email, password, name } = input;

  const nameValue = name || undefined;

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // ─── Create user in Supabase ─────────────────────────────────────────────────

    const supabaseAdmin = getSupabaseAdmin();
    const { data: createData, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true, // skip email verification for mobile sign-up
        user_metadata: nameValue ? { name: nameValue } : {},
      });

    if (createError) {
      if ((createError.status ?? 0) >= 500) {
        return NextResponse.json({ error: 'Authentication provider unavailable' }, { status: 503 });
      }
      // 422 = email already registered
      if (createError.status === 422) {
        return NextResponse.json(
          { error: "Email already registered" },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Internal server error" }, {
        status: 500,
      });
    }

    // ─── Create profile in our DB ────────────────────────────────────────────────

    let user: { id: string; email: string; name: string | null };
    try {
      user = await prisma.user.create({
        data: {
          id: createData.user.id,
          email: createData.user.email!,
          name: nameValue ?? null,
        },
        select: { id: true, email: true, name: true },
      });
    } catch {
      // Clean up Supabase user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(createData.user.id).catch(() => {
        /* best-effort */
      });
      return NextResponse.json({ error: "Internal server error" }, {
        status: 500,
      });
    }

    // ─── Get session token ───────────────────────────────────────────────────────

    const supabase = getSupabaseClient();
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

    if (signInError && (signInError.status ?? 0) >= 500) {
      return NextResponse.json({ error: 'Authentication provider unavailable' }, { status: 503 });
    }
    if (signInError || !signInData.session) {
      return NextResponse.json({ error: "Internal server error" }, {
        status: 500,
      });
    }

    // Fire-and-forget: email failure must not break registration
    sendWelcomeEmail(user.email, user.name ?? undefined).catch(() => {
      console.error("[register] Welcome email delivery failed");
    });

    return NextResponse.json(
      {
        token: signInData.session.access_token,
        refreshToken: signInData.session.refresh_token,
        user,
      },
      { status: 201 },
    );
  } catch {
    console.error("[auth/register] request_failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiTelemetry('POST', '/api/auth/register', handlePOST);
