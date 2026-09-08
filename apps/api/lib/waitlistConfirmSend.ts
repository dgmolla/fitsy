/**
 * Sends the double opt-in confirmation for a waitlist row. Separate from the
 * route so it can be deferred with after() and unit-tested on its own.
 *
 * Throttle: at most one confirmation per address per 24h, via the ledger
 * (campaign "lifecycle", step "confirm"; recordSend refreshes sentAt on a
 * repeat). Never throws: a failed send just means the person can submit
 * the form again tomorrow.
 */
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend, sentWithin } from "@/lib/marketingLedger";
import { waitlistConfirmEmailContent } from "@/lib/lifecycleTemplates";
import { confirmUrl } from "@/lib/waitlistConfirm";

const RESEND_GAP_MS = 24 * 3600e3;

export async function sendWaitlistConfirmation(row: { id: string; email: string }): Promise<boolean> {
  try {
    const url = confirmUrl(row.id);
    if (!url) return false;
    if (await sentWithin(row.email, RESEND_GAP_MS)) return false;
    const { subject, html } = waitlistConfirmEmailContent(url);
    const ok = await sendMarketingEmail({ waitlistId: row.id, to: row.email, subject, html });
    if (ok) await recordSend(row.email, "lifecycle", "confirm");
    return ok;
  } catch {
    return false;
  }
}
