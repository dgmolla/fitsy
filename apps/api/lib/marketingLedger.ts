/**
 * Address-keyed ledger of marketing sends (MarketingSend).
 *
 * Two jobs: idempotency (a given campaign step goes to an address once, ever)
 * and the cross-campaign frequency cap (no address hears from marketing more
 * than once per MIN_GAP). Both are keyed on the normalized address, not on a
 * User or LaunchWaitlist id, for the same reason opt-out is (see
 * marketingEmail.ts isEmailOptedOut): the same person can be either or both.
 */
import { prisma } from "@/lib/restaurantService";
import { normalizeEmail } from "@/lib/waitlist";

/** Minimum gap between two marketing emails to one address. */
export const MARKETING_MIN_GAP_MS = 48 * 3600e3;

export type Campaign = "weekly" | "launch" | "lifecycle";

export async function wasSent(email: string, campaign: Campaign, step: string): Promise<boolean> {
  const row = await prisma.marketingSend.findUnique({
    where: { email_campaign_step: { email: normalizeEmail(email), campaign, step } },
    select: { id: true },
  });
  return row !== null;
}

/** How many of `emails` already have this step: one set query for dry-run reporting. */
export async function countSent(emails: string[], campaign: Campaign, step: string): Promise<number> {
  if (emails.length === 0) return 0;
  return prisma.marketingSend.count({
    where: { campaign, step, email: { in: emails.map(normalizeEmail) } },
  });
}

/** Records a confirmed send. Safe to call twice: the unique key makes it a no-op. */
export async function recordSend(email: string, campaign: Campaign, step: string): Promise<void> {
  await prisma.marketingSend.upsert({
    where: { email_campaign_step: { email: normalizeEmail(email), campaign, step } },
    create: { email: normalizeEmail(email), campaign, step },
    update: {},
  });
}

/** True when any marketing email went to this address within the last `gapMs`. */
export async function sentWithin(email: string, gapMs: number = MARKETING_MIN_GAP_MS): Promise<boolean> {
  const row = await prisma.marketingSend.findFirst({
    where: { email: normalizeEmail(email), sentAt: { gt: new Date(Date.now() - gapMs) } },
    select: { id: true },
  });
  return row !== null;
}
