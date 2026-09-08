import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { sendLaunchPush } from "@/lib/launchPush";
import { sendMarketingEmail, launchEmailContent } from "@/lib/marketingEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/internal/waitlist/notify - notify waitlist users when a city launches.
 *
 * Matches entries whose coarse location is within `radiusMiles` of the launch
 * center. Website signups (POST /api/waitlist/web) carry no location, so they
 * never radius-match; pass `includeUnlocated: true` to fold them into a
 * launch blast (typically the first city launch).
 *
 * Attempts BOTH push and email for every matched entry (not push-primary/email-fallback).
 * Push needs a linked account with a token; email goes to everyone not opted out.
 * Marks notifiedAt when EITHER channel succeeds.
 *
 * Auth: CRON_SECRET Bearer (same as other internal endpoints).
 * Body: { lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }
 * Response: { ok, matched, viaPush, viaEmail, notified, failed }
 */

function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // earth radius, miles
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = request.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { lat, lng, radiusMiles, city, includeUnlocated, dryRun } = (body ?? {}) as {
    lat?: number;
    lng?: number;
    radiusMiles?: number;
    city?: string;
    includeUnlocated?: boolean;
    dryRun?: boolean;
  };
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json(
      { error: "lat and lng (launch center) are required" },
      { status: 400 },
    );
  }
  const radius = typeof radiusMiles === "number" && radiusMiles > 0 ? radiusMiles : 30;

  type WaitlistRow = {
    id: string;
    userId: string | null;
    email: string;
    lat: number | null;
    lng: number | null;
    city: string | null;
    user: { pushToken: string | null } | null;
  };

  const pending: WaitlistRow[] = await prisma.launchWaitlist.findMany({
    where: {
      notifiedAt: null,
      emailOptOutAt: null,
      OR: [{ userId: null }, { user: { emailOptOutAt: null } }],
    },
    select: {
      id: true,
      userId: true,
      email: true,
      lat: true,
      lng: true,
      city: true,
      user: { select: { pushToken: true } },
    },
  });

  const inArea = pending.filter((w) =>
    w.lat === null || w.lng === null
      ? includeUnlocated === true
      : milesBetween(lat, lng, w.lat, w.lng) <= radius,
  );

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, matched: inArea.length });
  }

  let viaPush = 0;
  let viaEmail = 0;
  let notified = 0;
  let failed = 0;

  for (const w of inArea) {
    const effectiveCity = city ?? w.city;

    // Attempt both channels in parallel. Opt-out for account-linked rows lives
    // on the User; for web-only rows it lives on the waitlist row itself.
    const recipient =
      w.userId !== null ? { userId: w.userId } : { waitlistId: w.id };
    const [pushed, emailed] = await Promise.all([
      w.user ? sendLaunchPush(w.user.pushToken, effectiveCity) : Promise.resolve(false),
      (async () => {
        const { subject, html } = launchEmailContent(effectiveCity);
        return sendMarketingEmail({ ...recipient, to: w.email, subject, html });
      })(),
    ]);

    const either = pushed || emailed;

    if (either) {
      await prisma.launchWaitlist.update({
        where: { id: w.id },
        data: { notifiedAt: new Date() },
      });
      notified++;
      if (pushed) viaPush++;
      if (emailed) viaEmail++;
    } else {
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    matched: inArea.length,
    viaPush,
    viaEmail,
    notified,
    failed,
  });
}
