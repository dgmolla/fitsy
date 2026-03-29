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
      name:
        (data.user.user_metadata?.["name"] as string | undefined) ?? null,
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
