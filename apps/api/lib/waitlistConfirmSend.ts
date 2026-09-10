/**
 * Sends the double opt-in confirmation for a waitlist row. Separate from the
 * route so it can be deferred with after() and unit-tested on its own.
 *
 * Throttle: at most one confirmation per address per 24h, enforced by a
 * conditional write on LaunchWaitlist.confirmSentAt (compare-and-set). Only
 * the request that wins the claim sends, so concurrent form posts for the
 * same address cannot each deliver a confirmation; a ledger read could not
 * give that guarantee. The consent request is a prerequisite, not a
 * marketing touch, so it deliberately does NOT sit behind the cross-campaign
 * frequency cap. A failed send releases the claim (so a later submit can
 * retry) and is reported to Slack, because an unconfirmed row never receives
 * anything else. Never throws.
 */
import { notifySlack } from "@fitsy/shared";
import { prisma } from "@/lib/restaurantService";
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend } from "@/lib/marketingLedger";
import { waitlistConfirmEmailContent } from "@/lib/lifecycleTemplates";
import { confirmUrl } from "@/lib/waitlistConfirm";

export const CONFIRM_RESEND_GAP_MS = 24 * 3600e3;

export async function sendWaitlistConfirmation(row: { id: string; email: string }): Promise<boolean> {
  const now = new Date();
  try {
    const url = confirmUrl(row.id);
    if (!url) return false;

    const claimed = await prisma.launchWaitlist.updateMany({
      where: {
        id: row.id,
        confirmedAt: null,
        OR: [{ confirmSentAt: null }, { confirmSentAt: { lt: new Date(now.getTime() - CONFIRM_RESEND_GAP_MS) } }],
      },
      data: { confirmSentAt: now },
    });
    if (claimed.count !== 1) return false;

    const { subject, html } = waitlistConfirmEmailContent(url);
    const ok = await sendMarketingEmail({
      waitlistId: row.id,
      to: row.email,
      subject,
      html,
      idempotencyKey: `lifecycle:confirm:${row.email}`,
    });
    if (ok) {
      await recordSend(row.email, "lifecycle", "confirm");
      return true;
    }
    await releaseClaim(row.id, now);
    await notifySlack(
      "waitlist confirmation not sent",
      `Confirmation email for a new waitlist signup failed at the provider; the row stays unconfirmed and gets nothing else. Re-submitting the form retries.`,
      { source: "waitlist-confirm" },
    );
    return false;
  } catch {
    await releaseClaim(row.id, now).catch(() => undefined);
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
