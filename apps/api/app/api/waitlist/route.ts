import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/waitlist - join the launch waitlist.
 *
 * Called when an authenticated onboarding user hits "we're not in your area
 * yet". We store their email (already collected at sign-in) plus a COARSE,
 * city-level location so we can email them when Fitsy launches near them.
 *
 * Data minimization: the location is rounded to ~1 decimal (~11 km) before
 * storage - enough to match a city, not a precise fix. See
 * docs/engineering/backend/launch-waitlist.md for the ASC privacy disclosures.
 */

// Round to ~city precision so we never persist a precise location.
function coarse(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { lat, lng, city } = (body ?? {}) as {
    lat?: number;
    lng?: number;
    city?: string;
  };

  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json(
      { error: "lat and lng are required numbers" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: { email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const label = typeof city === "string" ? city.slice(0, 80) : null;

  // Upsert so re-hitting the screen refreshes the location without spamming
  // rows; we deliberately do NOT reset notifiedAt on update.
  await prisma.launchWaitlist.upsert({
    where: { userId: auth.sub },
    create: {
      userId: auth.sub,
      email: user.email,
      lat: coarse(lat),
      lng: coarse(lng),
      city: label,
    },
    update: {
      email: user.email,
      lat: coarse(lat),
      lng: coarse(lng),
      city: label,
    },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
