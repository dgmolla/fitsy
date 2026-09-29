/** The persisted RevenueCat proof shared by API access and mobile routing. */
export type SubscriptionRow = {
  status: string;
  expiresAt: Date | null;
  lastEventAt: Date | null;
} | null;

export type SubscriptionVerdict = "active" | "expired" | "never_subscribed" | "unknown";

const ENTITLED_STATUSES = new Set(["active", "billing_issue"]);
export const RC_VERDICT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function classifySubscription(sub: SubscriptionRow, now = Date.now()): {
  verdict: SubscriptionVerdict;
  stale: boolean;
  lastRcVerifiedAt: Date | null;
} {
  const verifiedAt = sub?.lastEventAt ?? null;
  if (!sub || !verifiedAt || verifiedAt.getTime() > now + 60_000 ||
      now - verifiedAt.getTime() > RC_VERDICT_MAX_AGE_MS) {
    return { verdict: "unknown", stale: true, lastRcVerifiedAt: verifiedAt };
  }
  if (sub.status === "never_subscribed") {
    return { verdict: "never_subscribed", stale: false, lastRcVerifiedAt: verifiedAt };
  }
  if (sub.status === "expired") {
    return { verdict: "expired", stale: false, lastRcVerifiedAt: verifiedAt };
  }
  if (ENTITLED_STATUSES.has(sub.status)) {
    if (sub.expiresAt && sub.expiresAt.getTime() <= now) {
      // A renewal may be pending until a newer RevenueCat proof arrives.
      return { verdict: "unknown", stale: true, lastRcVerifiedAt: verifiedAt };
    }
    return { verdict: "active", stale: false, lastRcVerifiedAt: verifiedAt };
  }
  return { verdict: "unknown", stale: true, lastRcVerifiedAt: verifiedAt };
}
