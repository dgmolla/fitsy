/**
 * HMAC-based unsubscribe tokens for one-click email opt-out (RFC 8058).
 *
 * Tokens are hex-encoded HMAC-SHA256 of userId, keyed by UNSUBSCRIBE_SECRET.
 * All functions are synchronous; never throw.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Returns a hex HMAC-SHA256 token, or null if UNSUBSCRIBE_SECRET is unset. */
export function makeUnsubscribeToken(userId: string): string | null {
  const secret = process.env["UNSUBSCRIBE_SECRET"];
  if (!secret) return null;
  return createHmac("sha256", secret).update(userId).digest("hex");
}

/**
 * Verifies a token in constant time.
 * Returns false on any mismatch or error — never throws.
 */
export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  try {
    const expected = makeUnsubscribeToken(userId);
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
 * Example: https://fitsy.org/unsubscribe?u=<userId>&t=<token>
 */
export function unsubscribeUrl(userId: string): string | null {
  const token = makeUnsubscribeToken(userId);
  if (!token) return null;
  return `https://fitsy.org/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}
