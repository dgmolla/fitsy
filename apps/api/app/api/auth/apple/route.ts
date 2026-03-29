import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseClient } from "@/lib/supabase";
import type { AppleAuthRequest, AppleAuthResponse } from "@fitsy/shared";

export async function POST(
  request: NextRequest,
): Promise<NextResponse<AppleAuthResponse | { error: string }>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body required" }, { status: 400 });
  }

  const { identityToken, authorizationCode, nonce, fullName } =
    body as Partial<AppleAuthRequest>;

  if (typeof identityToken !== "string" || !identityToken) {
    return NextResponse.json(
      { error: "identityToken is required" },
      { status: 400 },
    );
  }

  if (typeof authorizationCode !== "string" || !authorizationCode) {
    return NextResponse.json(
      { error: "authorizationCode is required" },
      { status: 400 },
    );
  }

  if (typeof nonce !== "string" || !nonce) {
    return NextResponse.json(
      { error: "nonce is required" },
      { status: 400 },
    );
  }

  // ─── Sign in via Supabase ────────────────────────────────────────────────────

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: identityToken,
    nonce,
  });

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
      : (data.user.user_metadata?.["name"] as string | undefined);

  // ─── Upsert profile in our DB ────────────────────────────────────────────────

  const existingUser = await prisma.user.findUnique({
    where: { id: data.user.id },
    select: { id: true },
  });
  const isNewUser = !existingUser;

  const user = await prisma.user.upsert({
    where: { id: data.user.id },
    update: {},
    create: {
      id: data.user.id,
      email: data.user.email!,
      name: derivedName ?? null,
    },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json(
    {
      token: data.session.access_token,
      user: { id: user.id, email: user.email, name: user.name },
      isNewUser,
    },
    { status: 200 },
  );
}
