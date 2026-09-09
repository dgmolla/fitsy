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

/**
 * Sends per cron invocation. Bounds function wall-time; the ledger makes
 * the next invocation pick up the remainder. Lives here (not in a route
 * file) because Next.js route modules may only export handlers and config.
 */
export const MAX_SENDS_PER_RUN = 500;

export type Campaign = "weekly" | "launch" | "lifecycle";

export async function wasSent(email: string, campaign: Campaign, step: string): Promise<boolean> {
  const row = await prisma.marketingSend.findUnique({
    where: { email_campaign_step: { email: normalizeEmail(email), campaign, step } },
    select: { id: true },
  });
  return row !== null;
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
