import { withApiTelemetry } from '@/lib/apiTelemetry';
import { parseRequestInput } from "@/lib/requestInput";
import { loginSchema, AUTH_BODY_MAX_BYTES, AUTH_INPUT_ERROR, providerDisplayName } from "@/lib/authInput";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseClient } from "@/lib/supabase";
import { authLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { trustedClientIp } from "@/lib/clientIp";
import { canUsePasswordLogin } from "@/lib/reviewerAccess";
import type { AuthApiResponse } from "@fitsy/shared";

async function handlePOST(
  request: NextRequest,
): Promise<NextResponse<AuthApiResponse | { error: string }>> {
  // ─── Rate limiting ───────────────────────────────────────────────────────────

  const rateResult = await authLimiter.check(trustedClientIp(request));
  if (!rateResult.ok) return rateLimitResponse(rateResult, 'Too many requests - please try again later');

  const input = await parseRequestInput(request, loginSchema, AUTH_BODY_MAX_BYTES, AUTH_INPUT_ERROR);
  if (input instanceof NextResponse) return input;
  const { email, password } = input;

  if (!canUsePasswordLogin(email)) {
    return NextResponse.json({ error: "Use Apple or Google to sign in" }, { status: 403 });
  }

  try {
    // ─── Sign in via Supabase ────────────────────────────────────────────────────

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });

    if (error && (error.status ?? 0) >= 500) {
      return NextResponse.json({ error: 'Authentication provider unavailable' }, { status: 503 });
    }
    if (error || !data.session || !data.user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // ─── Sync profile to our DB ──────────────────────────────────────────────────

    const user = await prisma.user.upsert({
      where: { id: data.user.id },
      update: {},
      create: {
        id: data.user.id,
        email: data.user.email!,
        name:
          providerDisplayName(data.user.user_metadata?.["name"]),
      },
      select: { id: true, email: true, name: true },
    });

    return NextResponse.json(
      {
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: { id: user.id, email: user.email, name: user.name },
      },
      { status: 200 },
    );
  } catch {
    console.error("[auth/login] request_failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiTelemetry('POST', '/api/auth/login', handlePOST);
