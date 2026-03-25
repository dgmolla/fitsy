import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { verifyPassword, signToken } from "@/services/authService";
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

  // ─── Validation ─────────────────────────────────────────────────────────────

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "email and password are required" } as never,
      { status: 400 },
    );
  }

  // ─── Authenticate ────────────────────────────────────────────────────────────

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Generic error — never reveal whether email exists
    const invalidCredentials = NextResponse.json(
      { error: "Invalid credentials" } as never,
      { status: 401 },
    );

    if (!user || !user.passwordHash) {
      return invalidCredentials;
    }

    const passwordValid = await verifyPassword(password, user.passwordHash);
    if (!passwordValid) {
      return invalidCredentials;
    }

    const token = await signToken({ sub: user.id, email: user.email });

    return NextResponse.json(
      { token, user: { id: user.id, email: user.email, name: user.name } },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "Internal server error" } as never, {
      status: 500,
    });
  }
}
