import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";
import type {
  SubscriptionVerifyRequest,
  SubscriptionVerifyResponse,
} from "@fitsy/shared";

// ─── POST /api/subscriptions/verify ──────────────────────────────────────────

export async function POST(
  request: NextRequest,
): Promise<NextResponse<SubscriptionVerifyResponse | { error: string }>> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth as never;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body required" }, { status: 400 });
  }

  const { receiptData, productId } = body as Partial<SubscriptionVerifyRequest>;

  if (typeof receiptData !== "string" || !receiptData) {
    return NextResponse.json(
      { error: "receiptData is required" },
      { status: 400 },
    );
  }

  if (typeof productId !== "string" || !productId) {
    return NextResponse.json(
      { error: "productId is required" },
      { status: 400 },
    );
  }

  // ─── Stub: Apple receipt validation ──────────────────────────────────────────
  // TODO: Integrate with Apple App Store Server API for real validation.
  // For now, log the receipt and proceed with subscription creation.
  // Receipt data is intentionally not logged — it may contain sensitive info.

  try {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    await prisma.subscription.upsert({
      where: { userId: auth.sub },
      create: {
        userId: auth.sub,
        plan: productId,
        status: "active",
        expiresAt,
      },
      update: {
        plan: productId,
        status: "active",
        expiresAt,
      },
    });

    return NextResponse.json(
      {
        success: true,
        plan: productId,
        status: "active",
        expiresAt: expiresAt.toISOString(),
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
