import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { signToken } from "@/services/authService";
import { verifyAppleToken } from "@/services/appleAuth";
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

  const { identityToken, authorizationCode, fullName, email } =
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

  // ─── Verify Apple identity token ─────────────────────────────────────────────

  let claims: { sub: string; email?: string; name?: string };
  try {
    claims = await verifyAppleToken(identityToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid identity token" },
      { status: 401 },
    );
  }

  const appleUserId = claims.sub;

  // Prefer email from Apple token claims, then from request body (first-time only)
  const resolvedEmail =
    claims.email ?? (typeof email === "string" ? email : undefined);

  // Derive display name from fullName field if present
  const derivedName =
    fullName?.givenName || fullName?.familyName
      ? [fullName?.givenName, fullName?.familyName].filter(Boolean).join(" ")
      : (claims.name ?? undefined);

  // ─── Find or create user ──────────────────────────────────────────────────────

  try {
    let isNewUser = false;

    // 1. Try to find by Apple user ID
    let user = await prisma.user.findUnique({
      where: { appleUserId },
      select: { id: true, email: true, name: true },
    });

    // 2. Fallback: find by email (link existing account)
    if (!user && resolvedEmail) {
      user = await prisma.user.findUnique({
        where: { email: resolvedEmail.toLowerCase().trim() },
        select: { id: true, email: true, name: true },
      });

      if (user) {
        // Link the Apple user ID to the existing email account
        await prisma.user.update({
          where: { id: user.id },
          data: { appleUserId },
        });
      }
    }

    // 3. Create new user
    if (!user) {
      if (!resolvedEmail) {
        return NextResponse.json(
          { error: "Email is required for new accounts" },
          { status: 400 },
        );
      }

      user = await prisma.user.create({
        data: {
          appleUserId,
          email: resolvedEmail.toLowerCase().trim(),
          name: derivedName ?? null,
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
