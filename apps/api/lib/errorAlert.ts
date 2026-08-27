/**
 * Server-error alerting to Slack (channel via @fitsy/shared notifySlack).
 *
 * reportServerError is fire-and-forget and never throws — it must be safe to
 * call from any catch block or from the Next.js onRequestError hook without
 * affecting the response. Alerts are deduped per context key so one broken
 * route retried by a client can't flood the channel.
 *
 * Serverless caveat: the dedup window is per-instance memory, so a burst that
 * fans out across cold instances can emit a few duplicates. That bounds noise
 * well enough without needing a shared store.
 */
import { notifySlack } from "@fitsy/shared";

const DEDUP_WINDOW_MS = 15 * 60 * 1000;
const lastAlertAt = new Map<string, number>();

/** Exported for tests. True when `key` hasn't alerted within the window. */
export function shouldAlert(key: string, now: number): boolean {
  const last = lastAlertAt.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  lastAlertAt.set(key, now);
  return true;
}

/** Exported for tests. */
export function resetAlertDedup(): void {
  lastAlertAt.clear();
}

export function reportServerError(context: string, err: unknown): void {
  try {
    if (!shouldAlert(context, Date.now())) return;
    const detail =
      err instanceof Error
        ? `${err.name}: ${err.message}\n${err.stack ?? ""}`
        : String(err);
    // Deliberately not awaited — notifySlack is caller-safe (3s timeout,
    // never throws) and the response must not wait on Slack.
    void notifySlack(`API error: ${context}`, detail, { source: "api" });
  } catch {
    // Alerting must never take down the caller.
  }
}
