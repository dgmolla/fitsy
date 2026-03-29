import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseAdmin, getSupabaseClient } from "@/lib/supabase";
import { sendWelcomeEmail } from "@/services/emailService";
import type { AuthApiResponse } from "@fitsy/shared";

export async function POST(
  request: NextRequest,
): Promise<NextResponse<AuthApiResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" } as never, {
      status: 400,
    });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body required" } as never, {
      status: 400,
    });
  }

  const { email, password, name } = body as Record<string, unknown>;

  // ─── Validation ─────────────────────────────────────────────────────────────

  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" } as never, {
      status: 400,
    });
  }

  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" } as never,
      { status: 400 },
    );
  }

  const nameValue =
    typeof name === "string" && name.length > 0 ? name : undefined;

  const normalizedEmail = email.toLowerCase().trim();

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
    // 422 = email already registered
    if (createError.status === 422) {
      return NextResponse.json(
        { error: "Email already registered" } as never,
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal server error" } as never, {
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
    return NextResponse.json({ error: "Internal server error" } as never, {
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

  if (signInError || !signInData.session) {
    return NextResponse.json({ error: "Internal server error" } as never, {
      status: 500,
    });
  }

  // Fire-and-forget: email failure must not break registration
  sendWelcomeEmail(user.email, user.name ?? undefined).catch(console.error);

  return NextResponse.json(
    { token: signInData.session.access_token, user },
    { status: 201 },
  );
}
