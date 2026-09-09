/**
 * Shared helpers for the launch waitlist (LaunchWaitlist), which is written by
 * two surfaces: onboarding "Notify me" (POST /api/waitlist, authed) and the
 * fitsy.org form (POST /api/waitlist/web, public). Both must key rows the same
 * way so one person is one row.
 */
import { isUndeliverableAddress } from "@/lib/marketingEmail";

/** RFC 5321 upper bound on a full address. */
const EMAIL_MAX_LEN = 254;

// Deliberately loose: one "@", something on each side, a dot in the domain.
// Resend does the real validation at send time; this only rejects obvious junk.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims and lowercases so `Dawit@Gmail.com` and `dawit@gmail.com` are one row. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * True when a (normalized) address is plausibly deliverable. Reserved TLDs are
 * rejected because every send to them hard-bounces, which hurts sending
 * reputation for real users.
 */
export function isValidWaitlistEmail(email: string): boolean {
  return (
    email.length <= EMAIL_MAX_LEN &&
    EMAIL_SHAPE.test(email) &&
    !isUndeliverableAddress(email)
  );
}

/** Rounds to ~city precision (1 decimal, ~11 km) so we never persist a precise location. */
export function coarseCoord(n: number): number {
  return Math.round(n * 10) / 10;
}
