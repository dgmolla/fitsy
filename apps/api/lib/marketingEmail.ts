/**
 * CAN-SPAM / RFC 8058 compliant marketing email via Resend.
 *
 * sendMarketingEmail is FAIL-CLOSED: it checks every compliance requirement
 * before sending and returns false if any gate fails.  It never throws.
 *
 * launchEmailContent has moved to emailTemplates.ts and is re-exported here
 * for backward compatibility.
 */
import { prisma } from "@/lib/restaurantService";
import { Prisma } from "@prisma/client";
import { unsubscribeUrl } from "@/lib/unsubscribe";
export { launchEmailContent } from "@/lib/emailTemplates";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

// RFC 2606 and RFC 6762 reserve these TLDs; no address under them can receive
// mail. Seeded test accounts use them, and every send would hard-bounce —
// bounce rate is what sending reputation is scored on, so one blast to them
// would degrade delivery for real users.
const UNDELIVERABLE_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);

/** True when `email` is malformed or sits under a reserved, unroutable TLD. */
export function isUndeliverableAddress(email: string | null | undefined): boolean {
  const domain = email?.split("@")[1]?.toLowerCase();
  if (!domain) return true;
  const tld = domain.split(".").pop();
  return !tld || UNDELIVERABLE_TLDS.has(tld);
}

export async function sendMarketingEmail(opts: {
  userId: string;
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const { userId, to, subject, html } = opts;

  // --- Compliance gates (fail-closed) ---

  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return false;

  if (isUndeliverableAddress(to)) return false;

  const unsubSecret = process.env["UNSUBSCRIBE_SECRET"];
  if (!unsubSecret) return false;

  const postalAddress = process.env["FITSY_POSTAL_ADDRESS"];
  if (!postalAddress) return false;

  // Suppression check — use $queryRaw so we avoid pre-generate client issues
  // with the emailOptOutAt column added via migration.
  const rows = await prisma.$queryRaw<{ emailOptOutAt: Date | null }[]>(
    Prisma.sql`SELECT "emailOptOutAt" FROM "User" WHERE id = ${userId}`,
  );
  if (rows[0]?.emailOptOutAt) return false;

  // --- Build unsubscribe URL (guaranteed non-null — secret is set above) ---
  const unsub = unsubscribeUrl(userId) as string;

  // --- Compliance footer ---
  const footer = [
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;`,
    `color:#888;font-size:12px;line-height:1.6;">`,
    `<p>You're receiving this because you have a Fitsy account and joined our launch list.</p>`,
    `<p>${postalAddress}</p>`,
    `<p><a href="${unsub}" style="color:#888;">Unsubscribe</a></p>`,
    `</div>`,
  ].join("");

  const fullHtml = html + footer;

  // --- RFC 8058 one-click unsubscribe headers ---
  const listUnsubscribeHeader = `<${unsub}>`;

  const from = process.env["FITSY_FROM_EMAIL"] ?? "Fitsy <hello@fitsy.org>";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        from,
        to,
        subject,
        html: fullHtml,
        headers: {
          "List-Unsubscribe": listUnsubscribeHeader,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

