import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";
import { coarseCoord, normalizeEmail } from "@/lib/waitlist";

export const runtime = "nodejs";

/**
 * POST /api/waitlist - join the launch waitlist from onboarding.
 *
 * Called when an authenticated onboarding user hits "we're not in your area
 * yet". We store their email (already collected at sign-in) plus a COARSE,
 * city-level location so we can email them when Fitsy launches near them.
 *
 * The list is keyed by email and shared with the fitsy.org waitlist form
 * (POST /api/waitlist/web). If this address already joined on the website,
 * the same row is linked to the account and gains the location.
 *
 * Data minimization: the location is rounded to ~1 decimal (~11 km) before
 * storage - enough to match a city, not a precise fix. See
 * docs/engineering/backend/launch-waitlist.md for the ASC privacy disclosures.
 */
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

  const email = normalizeEmail(user.email);
  const label = typeof city === "string" ? city.slice(0, 80) : null;
  const location = { lat: coarseCoord(lat), lng: coarseCoord(lng), city: label };

  // Upsert by email so re-hitting the screen refreshes the location without
  // spamming rows, and a prior website signup becomes this account's row.
  // We deliberately do NOT reset notifiedAt or emailOptOutAt on update.
  await prisma.launchWaitlist.upsert({
    where: { email },
    create: { email, userId: auth.sub, source: "onboarding", ...location },
    update: { userId: auth.sub, ...location },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
