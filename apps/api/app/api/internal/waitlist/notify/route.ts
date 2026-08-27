import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { sendLaunchPush } from "@/lib/launchPush";
import { sendMarketingEmail, launchEmailContent } from "@/lib/marketingEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/internal/waitlist/notify - notify waitlist users when a city launches.
 *
 * Attempts BOTH push and email for every matched entry (not push-primary/email-fallback).
 * Marks notifiedAt when EITHER channel succeeds.
 *
 * Auth: CRON_SECRET Bearer (same as other internal endpoints).
 * Body: { lat, lng, radiusMiles?, city?, dryRun? }
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
  const { lat, lng, radiusMiles, city, dryRun } = (body ?? {}) as {
    lat?: number;
    lng?: number;
    radiusMiles?: number;
    city?: string;
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
    userId: string;
    email: string;
    lat: number;
    lng: number;
    city: string | null;
    user: { pushToken: string | null };
  };

  const pending: WaitlistRow[] = await prisma.launchWaitlist.findMany({
    where: { notifiedAt: null },
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

  const inArea = pending.filter(
    (w) => milesBetween(lat, lng, w.lat, w.lng) <= radius,
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

    // Attempt both channels in parallel
    const [pushed, emailed] = await Promise.all([
      sendLaunchPush(w.user.pushToken, effectiveCity),
      (async () => {
        const { subject, html } = launchEmailContent(effectiveCity);
        return sendMarketingEmail({ userId: w.userId, to: w.email, subject, html });
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
