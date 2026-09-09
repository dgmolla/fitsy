/**
 * City-launch notification for the waitlist. Shared by the operator route
 * (POST /api/internal/waitlist/notify) and the launch-day cron
 * (GET /api/internal/waitlist/launch-day).
 *
 * Matches unnotified LaunchWaitlist rows whose coarse location is within
 * `radiusMiles` of the launch center. Website signups carry no location and
 * never radius-match; `includeUnlocated` folds them in (first launch only).
 *
 * Attempts BOTH push and email per entry. An email opt-out (unsubscribe)
 * suppresses only the email: "Notify me at launch" is a separately requested
 * notification, and the privacy page promises unsubscribing stops marketing
 * email only. notifiedAt is set when either channel succeeds. An opted-out
 * entry is also closed (`suppressed`) when its only allowed channel, push,
 * cannot deliver: no token, or the attempt failed (stale token). There is
 * nothing else we may ever send it, so retrying would only starve the
 * drain loop. Successful emails are written to the MarketingSend ledger
 * (campaign "launch"), and a ledger hit short-circuits the email so the
 * ledger backs up notifiedAt rather than merely trailing it.
 *
 * Bounded: at most MAX_PER_RUN rows are processed per call and the result
 * carries `remaining`, so a large blast is several calls (each idempotent
 * via notifiedAt) instead of one that dies at the function time limit.
 */
import { prisma } from "@/lib/restaurantService";
import { sendLaunchPush } from "@/lib/launchPush";
import {
  isEmailOptedOut,
  isUndeliverableAddress,
  launchEmailContent,
  sendMarketingEmail,
} from "@/lib/marketingEmail";
import { recordSend, wasSent } from "@/lib/marketingLedger";

export type LaunchNotifyOptions = {
  lat: number;
  lng: number;
  radiusMiles?: number | undefined;
  city?: string | null | undefined;
  includeUnlocated?: boolean | undefined;
  dryRun?: boolean | undefined;
};

/** Rows processed per call; the caller re-invokes while `remaining` > 0. */
export const MAX_PER_RUN = 400;

export type LaunchNotifyResult =
  | { dryRun: true; matched: number; wouldNotify: number; wouldSuppress: number }
  | {
      dryRun: false;
      matched: number;
      viaPush: number;
      viaEmail: number;
      notified: number;
      suppressed: number;
      failed: number;
      remaining: number;
    };

export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // earth radius, miles
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export async function notifyLaunch(opts: LaunchNotifyOptions): Promise<LaunchNotifyResult> {
  const { lat, lng, includeUnlocated, dryRun } = opts;
  const radius =
    typeof opts.radiusMiles === "number" && opts.radiusMiles > 0 ? opts.radiusMiles : 30;

  const pending = await prisma.launchWaitlist.findMany({
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

  // Reserved-TLD seed addresses can never be delivered: leave them out so
  // they are neither previewed as reachable nor retried on every run.
  const inArea = pending.filter(
    (w) =>
      !isUndeliverableAddress(w.email) &&
      (w.lat === null || w.lng === null
        ? includeUnlocated === true
        : milesBetween(lat, lng, w.lat, w.lng) <= radius),
  );

  if (dryRun) {
    // Preview the same split the live run reports, so `matched` alone never
    // overstates reach: an opted-out row with no push token produces nothing.
    let wouldSuppress = 0;
    for (const w of inArea) {
      if (!w.user?.pushToken && (await isEmailOptedOut(w.email))) wouldSuppress++;
    }
    return {
      dryRun: true,
      matched: inArea.length,
      wouldNotify: inArea.length - wouldSuppress,
      wouldSuppress,
    };
  }

  let viaPush = 0;
  let viaEmail = 0;
  let notified = 0;
  let suppressed = 0;
  let failed = 0;

  const batch = inArea.slice(0, MAX_PER_RUN);
  for (const w of batch) {
    const effectiveCity = opts.city ?? w.city;
    const pushToken = w.user?.pushToken ?? null;

    // Opt-out is keyed on the address across both tables; it gates email only.
    const optedOut = await isEmailOptedOut(w.email);
    const recipient = w.userId !== null ? { userId: w.userId } : { waitlistId: w.id };
    const step = effectiveCity ?? "launch";
    const alreadyEmailed = !optedOut && (await wasSent(w.email, "launch", step));

    const [pushed, emailed] = await Promise.all([
      pushToken ? sendLaunchPush(pushToken, effectiveCity) : Promise.resolve(false),
      optedOut
        ? Promise.resolve(false)
        : alreadyEmailed
          ? Promise.resolve(true)
          : (async () => {
              const { subject, html } = launchEmailContent(effectiveCity);
              return sendMarketingEmail({ ...recipient, to: w.email, subject, html });
            })(),
    ]);

    if (emailed && !alreadyEmailed) await recordSend(w.email, "launch", step);

    // Terminal when a channel succeeded, or when an opted-out row's only
    // allowed channel (push) is absent or just failed: nothing more to try.
    if (pushed || emailed || optedOut) {
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

  return {
    dryRun: false,
    matched: inArea.length,
    viaPush,
    viaEmail,
    notified,
    suppressed,
    failed,
    // Rows still needing work: not yet processed, plus this batch's failures.
    remaining: inArea.length - batch.length + failed,
  };
}
