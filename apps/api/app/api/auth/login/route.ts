import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseClient } from "@/lib/supabase";
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

  const { email, password } = body as Record<string, unknown>;

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "email and password are required" } as never,
      { status: 400 },
    );
  }

  // ─── Sign in via Supabase ────────────────────────────────────────────────────

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  });

  if (error || !data.session || !data.user) {
    return NextResponse.json(
      { error: "Invalid credentials" } as never,
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
        (data.user.user_metadata?.["name"] as string | undefined) ?? null,
    },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json(
    {
      token: data.session.access_token,
      user: { id: user.id, email: user.email, name: user.name },
    },
    { status: 200 },
  );
}
