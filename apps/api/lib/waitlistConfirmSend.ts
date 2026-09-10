/**
 * Sends the double opt-in confirmation for a waitlist row. Separate from the
 * route so it can be deferred with after() and unit-tested on its own.
 *
 * Permanent refusals come first and are silent: an address that opted out
 * (anywhere) or cannot be delivered to never gets a confirmation, claims no
 * slot, and raises no alert, so a third party re-submitting it cannot make
 * noise. Then the once-a-day slot is claimed with a conditional write on
 * LaunchWaitlist.confirmSentAt (compare-and-set): only the request that wins
 * the claim sends, so concurrent form posts for the same address cannot each
 * deliver a confirmation. The consent request is a prerequisite, not a
 * marketing touch, so it does NOT sit behind the cross-campaign frequency
 * cap. The claim is never given back, whatever happens after it: a provider
 * failure, a timeout after the provider accepted, a thrown ledger write.
 * The slot simply expires after CONFIRM_RESEND_GAP_MS, so no two attempts
 * for one row can ever be closer than that, and an ambiguous outcome cannot
 * turn into two deliveries. A failed attempt is reported to Slack with the
 * row id, because an unconfirmed row never receives anything else; the
 * ledger records only successes, which is how a retry (a re-submit after
 * the gap, or the daily lifecycle run) tells a failed claim from a sent one.
 * A missing signing secret is reported the same way: without it no website
 * signup can ever be confirmed, and the form still answered "check your
 * inbox". Both alerts sit behind the same
 * per-key dedup window as server-error alerts (lib/errorAlert.ts): this runs
 * from the unauthenticated form, so a burst of submissions during a provider
 * outage must not flood the channel the launch blast reports to. Never throws.
 */
import { notifySlack } from "@fitsy/shared";
import { shouldAlert } from "@/lib/errorAlert";
import { prisma } from "@/lib/restaurantService";
import { isEmailOptedOut, isUndeliverableAddress, sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend } from "@/lib/marketingLedger";
import { waitlistConfirmEmailContent } from "@/lib/lifecycleTemplates";
import { confirmUrl } from "@/lib/waitlistConfirm";

export const CONFIRM_RESEND_GAP_MS = 24 * 3600e3;

export async function sendWaitlistConfirmation(row: { id: string; email: string }): Promise<boolean> {
  const now = new Date();
  let delivered = false;
  try {
    const url = confirmUrl(row.id);
    if (!url) {
      if (shouldAlert("waitlist-confirm-secret", now.getTime())) {
        await notifySlack(
          "waitlist confirmation not sent",
          `Cannot mint a confirmation link for waitlist row ${row.id}: UNSUBSCRIBE_SECRET is not set. ` +
            `Every website signup stays unconfirmed until it is.`,
          { source: "waitlist-confirm" },
        );
      }
      return false;
    }

    // Permanent: nothing to send, ever. No claim, no alert.
    if (isUndeliverableAddress(row.email) || (await isEmailOptedOut(row.email))) return false;

    const claim = await prisma.launchWaitlist.updateMany({
      where: {
        id: row.id,
        confirmedAt: null,
        OR: [{ confirmSentAt: null }, { confirmSentAt: { lt: new Date(now.getTime() - CONFIRM_RESEND_GAP_MS) } }],
      },
      data: { confirmSentAt: now },
    });
    if (claim.count !== 1) return false;

    const { subject, html } = waitlistConfirmEmailContent(url);
    const ok = await sendMarketingEmail({
      waitlistId: row.id,
      to: row.email,
      subject,
      html,
      // One key per claim. Claims for a row are at least CONFIRM_RESEND_GAP_MS
      // apart, so a later attempt is never inside the provider's 24h
      // idempotency window with the same key, and never needs to be.
      idempotencyKey: `lifecycle:confirm:${row.email}:${now.toISOString()}`,
    });
    if (ok) {
      delivered = true;
      await recordSend(row.email, "lifecycle", "confirm");
      return true;
    }
    if (shouldAlert("waitlist-confirm", now.getTime())) {
      await notifySlack(
        "waitlist confirmation not sent",
        `Confirmation email for waitlist row ${row.id} failed at the provider; the row stays unconfirmed and gets nothing else. ` +
          `The 24h slot is kept, so a re-submit of the form retries after it expires.`,
        { source: "waitlist-confirm" },
      );
    }
    return false;
  } catch {
    return delivered;
  }
}
