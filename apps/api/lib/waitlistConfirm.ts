/**
 * Signed confirmation links for waitlist double opt-in.
 *
 * /waitlist/confirm?w=<waitlistId>&t=<token>, token = HMAC-SHA256 over
 * "confirm:<waitlistId>" keyed by UNSUBSCRIBE_SECRET (the one signing secret
 * for every email-link action). The prefix keeps confirm and unsubscribe
 * tokens from validating each other. Synchronous; never throws.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "confirm:";

export function makeConfirmToken(waitlistId: string): string | null {
  const secret = process.env["UNSUBSCRIBE_SECRET"];
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${PREFIX}${waitlistId}`).digest("hex");
}

export function verifyConfirmToken(waitlistId: string, token: string): boolean {
  try {
    const expected = makeConfirmToken(waitlistId);
    if (!expected || expected.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
  } catch {
    return false;
  }
}

export function confirmUrl(waitlistId: string): string | null {
  const token = makeConfirmToken(waitlistId);
  if (!token) return null;
  return `https://fitsy.org/waitlist/confirm?w=${encodeURIComponent(waitlistId)}&t=${encodeURIComponent(token)}`;
}
