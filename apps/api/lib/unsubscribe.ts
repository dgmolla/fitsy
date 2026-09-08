/**
 * HMAC-based unsubscribe tokens for one-click email opt-out (RFC 8058).
 *
 * Two kinds of recipient can be unsubscribed:
 *   - an account:            /unsubscribe?u=<userId>&t=<token>
 *   - a waitlist-only email: /unsubscribe?w=<waitlistId>&t=<token>
 *
 * Tokens are hex-encoded HMAC-SHA256 over a subject string, keyed by
 * UNSUBSCRIBE_SECRET. Account subjects are the bare userId (unchanged since
 * launch so existing links keep working); waitlist subjects are prefixed so a
 * token minted for one kind can never validate the other.
 * All functions are synchronous; never throw.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type UnsubscribeSubject = { userId: string } | { waitlistId: string };

const WAITLIST_PREFIX = "waitlist:";

function subjectString(subject: UnsubscribeSubject): string {
  return "userId" in subject ? subject.userId : `${WAITLIST_PREFIX}${subject.waitlistId}`;
}

/** Returns a hex HMAC-SHA256 token, or null if UNSUBSCRIBE_SECRET is unset. */
export function makeUnsubscribeToken(subject: string | UnsubscribeSubject): string | null {
  const secret = process.env["UNSUBSCRIBE_SECRET"];
  if (!secret) return null;
  const s = typeof subject === "string" ? subject : subjectString(subject);
  return createHmac("sha256", secret).update(s).digest("hex");
}

/**
 * Verifies a token in constant time.
 * Returns false on any mismatch or error — never throws.
 */
export function verifyUnsubscribeToken(
  subject: string | UnsubscribeSubject,
  token: string,
): boolean {
  try {
    const expected = makeUnsubscribeToken(subject);
    if (!expected) return false;
    // Guard against length mismatch before timingSafeEqual (which requires equal lengths)
    if (expected.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Returns a fully-qualified unsubscribe URL, or null if UNSUBSCRIBE_SECRET is unset.
 * Examples:
 *   https://fitsy.org/unsubscribe?u=<userId>&t=<token>
 *   https://fitsy.org/unsubscribe?w=<waitlistId>&t=<token>
 */
export function unsubscribeUrl(subject: string | UnsubscribeSubject): string | null {
  const token = makeUnsubscribeToken(subject);
  if (!token) return null;
  const s = typeof subject === "string" ? { userId: subject } : subject;
  const param =
    "userId" in s
      ? `u=${encodeURIComponent(s.userId)}`
      : `w=${encodeURIComponent(s.waitlistId)}`;
  return `https://fitsy.org/unsubscribe?${param}&t=${encodeURIComponent(token)}`;
}
