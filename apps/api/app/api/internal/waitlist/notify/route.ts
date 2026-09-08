import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { sendLaunchPush } from "@/lib/launchPush";
import { isEmailOptedOut, launchEmailContent, sendMarketingEmail } from "@/lib/marketingEmail";

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
 * Push needs a linked account with a token. An email opt-out (unsubscribe)
 * suppresses only the email: "Notify me at launch" is a separately requested
 * notification, and the privacy page promises unsubscribing stops marketing
 * email only. Marks notifiedAt when EITHER channel succeeds, and also when an
 * opted-out entry has no push token (nothing we may send; counted as
 * `suppressed`) so the job converges instead of re-matching it forever.
 *
 * Auth: CRON_SECRET Bearer (same as other internal endpoints).
 * Body: { lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }
 * Response: { ok, matched, viaPush, viaEmail, notified, suppressed, failed }
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
  let suppressed = 0;
  let failed = 0;

  for (const w of inArea) {
    const effectiveCity = city ?? w.city;
    const pushToken = w.user?.pushToken ?? null;

    // Opt-out is keyed on the address across both tables; it gates email only.
    const optedOut = await isEmailOptedOut(w.email);
    const recipient =
      w.userId !== null ? { userId: w.userId } : { waitlistId: w.id };

    const [pushed, emailed] = await Promise.all([
      pushToken ? sendLaunchPush(pushToken, effectiveCity) : Promise.resolve(false),
      optedOut
        ? Promise.resolve(false)
        : (async () => {
            const { subject, html } = launchEmailContent(effectiveCity);
            return sendMarketingEmail({ ...recipient, to: w.email, subject, html });
          })(),
    ]);

    // Terminal when a channel succeeded, or when nothing may ever be sent.
    const nothingAllowed = optedOut && !pushToken;
    if (pushed || emailed || nothingAllowed) {
      await prisma.launchWaitlist.update({
        where: { id: w.id },
        data: { notifiedAt: new Date() },
      });
      if (pushed) viaPush++;
      if (emailed) viaEmail++;
      if (pushed || emailed) notified++;
      else suppressed++;
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
    suppressed,
    failed,
  });
}
