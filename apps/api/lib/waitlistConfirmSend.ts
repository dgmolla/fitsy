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
 * row never receives anything else. Never throws.
 */
import { notifySlack } from "@fitsy/shared";
import { prisma } from "@/lib/restaurantService";
import { isEmailOptedOut, isUndeliverableAddress, sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend } from "@/lib/marketingLedger";
import { waitlistConfirmEmailContent } from "@/lib/lifecycleTemplates";
import { confirmUrl } from "@/lib/waitlistConfirm";

export const CONFIRM_RESEND_GAP_MS = 24 * 3600e3;

export async function sendWaitlistConfirmation(row: { id: string; email: string }): Promise<boolean> {
  const now = new Date();
  let claimed = false;
  try {
    const url = confirmUrl(row.id);
    if (!url) return false;

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
      // Per attempt: a re-send a day later must not be deduped away by the
      // provider's 24h idempotency window.
      idempotencyKey: `lifecycle:confirm:${row.email}:${now.toISOString()}`,
    });
    if (ok) {
      await recordSend(row.email, "lifecycle", "confirm");
      return true;
    }
    await releaseClaim(row.id, now);
    await notifySlack(
      "waitlist confirmation not sent",
      `Confirmation email for waitlist row ${row.id} failed at the provider; the row stays unconfirmed and gets nothing else. ` +
        `The claim was released, so re-submitting the form retries.`,
      { source: "waitlist-confirm" },
    );
    return false;
  } catch {
    if (claimed) await releaseClaim(row.id, now).catch(() => undefined);
    return false;
  }
}

/** Give the slot back only if it is still ours (another request may have re-claimed). */
async function releaseClaim(id: string, ours: Date): Promise<void> {
  await prisma.launchWaitlist.updateMany({
    where: { id, confirmSentAt: ours },
    data: { confirmSentAt: null },
  });
}
