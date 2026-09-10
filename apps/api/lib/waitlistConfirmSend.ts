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
 * cap. A transient provider failure releases the claim (a later submit can
 * retry) and is reported to Slack with the row id, because an unconfirmed
 * row never receives anything else. Once the provider has accepted the
 * email the claim is kept no matter what fails afterwards (the ledger
 * write is bookkeeping, not the throttle), so a retry cannot deliver twice. A missing signing secret is reported
 * the same way: without it no website signup can ever be confirmed, and the
 * form still answered "check your inbox". Both alerts sit behind the same
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
  let claimed = false;
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
    claimed = true;

    const { subject, html } = waitlistConfirmEmailContent(url);
    const ok = await sendMarketingEmail({
      waitlistId: row.id,
      to: row.email,
      subject,
      html,
      // Keyed by the claim window, not the attempt instant: a re-send a day
      // later gets a new key (the provider's idempotency window is 24h), but
      // a retry after an ambiguous outcome (timeout after the provider
      // accepted) inside the same window is deduped by the provider.
      idempotencyKey: `lifecycle:confirm:${row.email}:${Math.floor(now.getTime() / CONFIRM_RESEND_GAP_MS)}`,
    });
    if (ok) {
      delivered = true;
      await recordSend(row.email, "lifecycle", "confirm");
      return true;
    }
    await releaseClaim(row.id, now);
    if (shouldAlert("waitlist-confirm", now.getTime())) {
      await notifySlack(
        "waitlist confirmation not sent",
        `Confirmation email for waitlist row ${row.id} failed at the provider; the row stays unconfirmed and gets nothing else. ` +
          `The claim was released, so re-submitting the form retries.`,
        { source: "waitlist-confirm" },
      );
    }
    return false;
  } catch {
    if (claimed && !delivered) await releaseClaim(row.id, now).catch(() => undefined);
    return delivered;
  }
}

/** Give the slot back only if it is still ours (another request may have re-claimed). */
async function releaseClaim(id: string, ours: Date): Promise<void> {
  await prisma.launchWaitlist.updateMany({
    where: { id, confirmSentAt: ours },
    data: { confirmSentAt: null },
  });
}
