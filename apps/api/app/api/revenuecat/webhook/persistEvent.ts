import { prisma } from "@/lib/restaurantService";
import { logStatusChange, type SubscriptionRow } from "@/lib/subscription";

/** Persist only while the event is at least as recent as the stored proof. */
export async function persistEvent(input: {
  userId: string;
  existing: SubscriptionRow;
  plan: string;
  status: string;
  expiresAt: Date | null;
  appleTransactionId: string | null;
  eventAt: Date;
}): Promise<boolean> {
  const { userId, existing, eventAt, status, ...fields } = input;
  const data = { ...fields, status, lastEventAt: eventAt };
  const update = async (priorStatus: string) => {
    const result = await prisma.subscription.updateMany({
      where: { userId, OR: [{ lastEventAt: null }, { lastEventAt: { lte: eventAt } }] },
      data,
    });
    if (result.count) logStatusChange(userId, priorStatus, status, "webhook");
    return result.count > 0;
  };
  if (existing) return update(existing.status);
  try {
    await prisma.subscription.create({ data: { userId, ...data } });
    logStatusChange(userId, null, status, "webhook");
    return true;
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const raced = await prisma.subscription.findUnique({
      where: { userId }, select: { status: true, lastEventAt: true },
    });
    if (!raced) throw error;
    if (raced.lastEventAt && raced.lastEventAt.getTime() > eventAt.getTime()) return false;
    return update(raced.status);
  }
}
