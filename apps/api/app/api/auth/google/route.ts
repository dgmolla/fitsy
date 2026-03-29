import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { getSupabaseClient } from "@/lib/supabase";

interface GoogleAuthResponse {
  token: string;
  user: { id: string; email: string; name: string | null };
  isNewUser: boolean;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<GoogleAuthResponse | { error: string }>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body required" }, { status: 400 });
  }

  const { idToken } = body as Partial<{ idToken: string }>;

  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json(
      { error: "idToken is required" },
      { status: 400 },
    );
  }

  // ─── Sign in via Supabase ────────────────────────────────────────────────────

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });

  if (error || !data.session || !data.user) {
    return NextResponse.json(
      { error: "Invalid Google ID token" },
      { status: 401 },
    );
  }

  // ─── Upsert profile in our DB ────────────────────────────────────────────────

  const email = data.user.email;
  if (!email) {
    return NextResponse.json(
      { error: "Google account has no email" },
      { status: 400 },
    );
  }

  const derivedName =
    (data.user.user_metadata?.["name"] as string | undefined) ?? null;

  let existingUser = await prisma.user.findUnique({
    where: { id: data.user.id },
    select: { id: true },
  });

  // If no user with this Supabase ID, check if one exists with the same email
  // (e.g. previously registered via email/password with a different auth provider)
  if (!existingUser) {
    const userByEmail = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (userByEmail) {
      // Link: update existing user's ID to the new Supabase auth ID
      await prisma.user.update({
        where: { email },
        data: { id: data.user.id },
      });
      existingUser = { id: data.user.id };
    }
  }

  const isNewUser = !existingUser;

  const user = await prisma.user.upsert({
    where: { id: data.user.id },
    update: {},
    create: {
      id: data.user.id,
      email,
      name: derivedName,
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
