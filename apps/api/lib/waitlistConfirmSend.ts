/**
 * Sends the double opt-in confirmation for a waitlist row. Separate from the
 * route so it can be deferred with after() and unit-tested on its own.
 *
 * Throttle: at most one confirmation per address per 24h, keyed on the
 * confirmation step itself (campaign "lifecycle", step "confirm"; recordSend
 * refreshes sentAt on a repeat). The consent request is a prerequisite, not
 * a marketing touch, so it deliberately does NOT sit behind the
 * cross-campaign frequency cap: an unrelated email yesterday must not
 * suppress someone's first-ever confirmation. Never throws: a failed send
 * just means the person can submit the form again tomorrow.
 */
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { recordSend, sentStepWithin } from "@/lib/marketingLedger";
import { waitlistConfirmEmailContent } from "@/lib/lifecycleTemplates";
import { confirmUrl } from "@/lib/waitlistConfirm";

const RESEND_GAP_MS = 24 * 3600e3;

export async function sendWaitlistConfirmation(row: { id: string; email: string }): Promise<boolean> {
  try {
    const url = confirmUrl(row.id);
    if (!url) return false;
    if (await sentStepWithin(row.email, "lifecycle", "confirm", RESEND_GAP_MS)) return false;
    const { subject, html } = waitlistConfirmEmailContent(url);
    const ok = await sendMarketingEmail({ waitlistId: row.id, to: row.email, subject, html });
    if (ok) await recordSend(row.email, "lifecycle", "confirm");
    return ok;
  } catch {
    return false;
  }
}
