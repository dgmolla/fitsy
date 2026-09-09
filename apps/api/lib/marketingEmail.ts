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
import { unsubscribeUrl, type UnsubscribeSubject } from "@/lib/unsubscribe";
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

/**
 * Who the email is for, which decides which unsubscribe link is minted: an
 * account (`?u=`) or a waitlist-only email with no account (`?w=`).
 * Suppression itself is keyed on the address, not the record: see
 * isEmailOptedOut.
 */
export type MarketingRecipient =
  | { userId: string; waitlistId?: undefined }
  | { waitlistId: string; userId?: undefined };

/**
 * True when ANY record for this address has opted out: the User row (set by
 * `?u=` links) or the LaunchWaitlist row (set by `?w=` links). An address can
 * exist on both tables, linked or not, and can move between them (a website
 * signup that later creates an account, or the reverse), so an opt-out
 * recorded on either must win for every send path.
 */
export async function isEmailOptedOut(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const rows = await prisma.$queryRaw<{ n: number }[]>(
    Prisma.sql`SELECT 1 AS n FROM "User" WHERE lower("email") = ${normalized} AND "emailOptOutAt" IS NOT NULL
      UNION ALL
      SELECT 1 AS n FROM "LaunchWaitlist" WHERE "email" = ${normalized} AND "emailOptOutAt" IS NOT NULL
      LIMIT 1`,
  );
  return rows.length > 0;
}

/**
 * Set-query form of isEmailOptedOut for previews: which of `emails` have an
 * opt-out on either table. One round trip regardless of audience size.
 */
export async function optedOutAddresses(emails: string[]): Promise<Set<string>> {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  if (normalized.length === 0) return new Set();
  const rows = await prisma.$queryRaw<{ email: string }[]>(
    Prisma.sql`SELECT lower("email") AS email FROM "User"
        WHERE lower("email") IN (${Prisma.join(normalized)}) AND "emailOptOutAt" IS NOT NULL
      UNION
      SELECT "email" FROM "LaunchWaitlist"
        WHERE "email" IN (${Prisma.join(normalized)}) AND "emailOptOutAt" IS NOT NULL`,
  );
  return new Set(rows.map((r) => r.email));
}

export async function sendMarketingEmail(
  opts: MarketingRecipient & {
    to: string;
    subject: string;
    html: string;
    /**
     * Provider-side dedup for retries (Resend honours it for 24h). Callers
     * derive it from the ledger key (campaign, step, address) so a retry of
     * a send whose response was lost cannot deliver twice.
     */
    idempotencyKey?: string | undefined;
  },
): Promise<boolean> {
  const { to, subject, html } = opts;

  // --- Compliance gates (fail-closed) ---

  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return false;

  if (isUndeliverableAddress(to)) return false;

  const unsubSecret = process.env["UNSUBSCRIBE_SECRET"];
  if (!unsubSecret) return false;

  const postalAddress = process.env["FITSY_POSTAL_ADDRESS"];
  if (!postalAddress) return false;

  // Suppression is keyed on the address so no record-level gap can bypass it.
  if (await isEmailOptedOut(to)) return false;

  // --- Build unsubscribe URL (guaranteed non-null — secret is set above) ---
  const recipient: UnsubscribeSubject =
    opts.userId !== undefined ? { userId: opts.userId } : { waitlistId: opts.waitlistId };
  const unsub = unsubscribeUrl(recipient) as string;
  const why =
    opts.userId !== undefined
      ? "You're receiving this because you have a Fitsy account and joined our launch list."
      : "You're receiving this because you joined the Fitsy launch list at fitsy.org.";

  // --- Compliance footer ---
  const footer = [
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;`,
    `color:#888;font-size:12px;line-height:1.6;">`,
    `<p>${why}</p>`,
    `<p>${postalAddress}</p>`,
    `<p><a href="${unsub}" style="color:#888;">Unsubscribe</a></p>`,
    `</div>`,
  ].join("");

  const fullHtml = html + footer;

  // --- RFC 8058 one-click unsubscribe headers ---
  const listUnsubscribeHeader = `<${unsub}>`;

  const from = process.env["FITSY_FROM_EMAIL"] ?? "Fitsy <hello@fitsy.org>";

  const body = JSON.stringify({
    from,
    to,
    subject,
    html: fullHtml,
    headers: {
      "List-Unsubscribe": listUnsubscribeHeader,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  // Sequential cron loops can trip the provider's per-second limit; honour
  // one 429 with its Retry-After (capped) before giving up on this address.
  // A false here is retried by the caller on its next run, never dropped.
  const first = await postResend(apiKey, body, opts.idempotencyKey);
  if (first.status !== 429) return first.ok;
  await sleep(Math.min(first.retryAfterMs ?? 1000, MAX_RETRY_AFTER_MS));
  return (await postResend(apiKey, body, opts.idempotencyKey)).ok;
}

const MAX_RETRY_AFTER_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postResend(
  apiKey: string,
  body: string,
  idempotencyKey?: string,
): Promise<{ ok: boolean; status: number; retryAfterMs?: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      signal: ctrl.signal,
      body,
    });
    const retryAfter = Number(res.headers?.get?.("retry-after"));
    return {
      ok: res.ok,
      status: res.status,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
    };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

