/**
 * Who marketing email can go to, across both tables:
 *   - accounts (User) that have not opted out anywhere, and
 *   - waitlist-only addresses (LaunchWaitlist with no account) that have not
 *     opted out.
 * One address is one recipient: a waitlist row linked to an account is
 * represented by the account. Reserved-TLD seed addresses are excluded so
 * counts reflect the real audience and nothing hard-bounces.
 */
import { prisma } from "@/lib/restaurantService";
import { isUndeliverableAddress } from "@/lib/marketingEmail";

export type MarketingRecipientRow =
  | { email: string; userId: string; waitlistId?: undefined }
  | { email: string; waitlistId: string; userId?: undefined };

export async function marketingAudience(): Promise<MarketingRecipientRow[]> {
  // Opt-out is address-keyed: a waitlist row for the same email that opted
  // out via a ?w= link counts against the account, linked or not.
  const users = await prisma.$queryRawUnsafe<{ id: string; email: string }[]>(
    `SELECT u.id, lower(u.email) AS email FROM "User" u
      WHERE u."emailOptOutAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "LaunchWaitlist" w
           WHERE w."email" = lower(u."email") AND w."emailOptOutAt" IS NOT NULL
        )`,
  );
  const waitlistOnly = await prisma.launchWaitlist.findMany({
    where: { userId: null, emailOptOutAt: null },
    select: { id: true, email: true },
  });

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
