import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { signToken } from "@/services/authService";
import { verifyGoogleToken } from "@/services/googleAuth";

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

  // ─── Verify Google ID token ───────────────────────────────────────────────────

  let claims: { sub: string; email: string; name?: string | undefined };
  try {
    claims = await verifyGoogleToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid Google ID token" },
      { status: 401 },
    );
  }

  const { sub: googleUserId, email, name } = claims;

  // ─── Find or create user ──────────────────────────────────────────────────────

  try {
    let isNewUser = false;

    // 1. Try to find by Google user ID
    let user = await prisma.user.findFirst({
      where: { googleUserId },
      select: { id: true, email: true, name: true },
    });

    // 2. Fallback: find by email (link existing account)
    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: { id: true, email: true, name: true },
      });

      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { googleUserId },
        });
      }
    }

    // 3. Create new user
    if (!user) {
      user = await prisma.user.create({
        data: {
          googleUserId,
          email: email.toLowerCase().trim(),
          name: name ?? null,
        },
        select: { id: true, email: true, name: true },
      });
      isNewUser = true;
    }

    const token = await signToken({ sub: user.id, email: user.email });

    return NextResponse.json(
      { token, user: { id: user.id, email: user.email, name: user.name }, isNewUser },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
