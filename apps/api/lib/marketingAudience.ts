/**
 * Who marketing email can go to, across both tables:
 *   - accounts (User) that have not opted out anywhere, and
 *   - optionally, waitlist-only addresses (LaunchWaitlist with no account)
 *     that have not opted out anywhere.
 * One address is one recipient: a waitlist row linked to an account is
 * represented by the account. Reserved-TLD seed addresses are excluded so
 * counts reflect the real audience and nothing hard-bounces.
 *
 * Opt-out is address-keyed, so each branch mirrors the other table's
 * opt-out: an account is excluded when a waitlist row for its address opted
 * out, and a waitlist row is excluded when an account with its address opted
 * out (the row may be unlinked, e.g. the form was submitted after signup).
 *
 * Waitlist-only rows are opt-in (`includeWaitlistOnly`): recurring email to
 * addresses that only ever typed themselves into a public form waits for the
 * double opt-in confirmation (next PR), which will gate this on confirmedAt.
 * The launch blast is the explicitly requested notification and does not go
 * through this helper.
 */
import { prisma } from "@/lib/restaurantService";
import { isUndeliverableAddress } from "@/lib/marketingEmail";

export type MarketingRecipientRow =
  | { email: string; userId: string; waitlistId?: undefined }
  | { email: string; waitlistId: string; userId?: undefined };

export async function marketingAudience(
  opts: { includeWaitlistOnly: boolean },
): Promise<MarketingRecipientRow[]> {
  const users = await prisma.$queryRawUnsafe<{ id: string; email: string }[]>(
    `SELECT u.id, lower(u.email) AS email FROM "User" u
      WHERE u."emailOptOutAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "LaunchWaitlist" w
           WHERE w."email" = lower(u."email") AND w."emailOptOutAt" IS NOT NULL
        )
      ORDER BY u."createdAt" ASC, u.id ASC`,
  );
  const waitlistOnly = opts.includeWaitlistOnly
    ? await prisma.$queryRawUnsafe<{ id: string; email: string }[]>(
        `SELECT w.id, w.email FROM "LaunchWaitlist" w
          WHERE w."userId" IS NULL
            AND w."emailOptOutAt" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM "User" u
               WHERE lower(u."email") = w."email" AND u."emailOptOutAt" IS NOT NULL
            )
          ORDER BY w."createdAt" ASC, w.id ASC`,
      )
    : [];

  const seen = new Set<string>();
  const out: MarketingRecipientRow[] = [];
  for (const u of users) {
    if (isUndeliverableAddress(u.email) || seen.has(u.email)) continue;
    seen.add(u.email);
    out.push({ email: u.email, userId: u.id });
  }
  for (const w of waitlistOnly) {
    if (isUndeliverableAddress(w.email) || seen.has(w.email)) continue;
    seen.add(w.email);
    out.push({ email: w.email, waitlistId: w.id });
  }
  return out;
}
