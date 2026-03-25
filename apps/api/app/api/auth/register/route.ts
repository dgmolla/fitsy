import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { hashPassword, signToken } from "@/services/authService";
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

  // ─── Create user ────────────────────────────────────────────────────────────

  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        name: nameValue ?? null,
      },
      select: { id: true, email: true, name: true },
    });

    const token = await signToken({ sub: user.id, email: user.email });

    // Fire-and-forget: email failure must not break registration
    sendWelcomeEmail(user.email, user.name ?? undefined).catch(console.error);

    return NextResponse.json({ token, user }, { status: 201 });
  } catch (err) {
    // Prisma unique constraint violation on email
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Email already registered" } as never,
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal server error" } as never, {
      status: 500,
    });
  }
}
