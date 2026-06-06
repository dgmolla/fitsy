/**
 * Best-effort Slack alert via chat.postMessage. Reads SLACK_BOT_TOKEN and
 * SLACK_ALERT_CHANNEL from process.env. Silently no-ops if the token is
 * unset (local dev) so callers can fire and forget. 3s timeout so a Slack
 * outage never delays the caller.
 *
 * Used by:
 *   - scripts/preload-ue-first.ts — pipeline failure alerts
 *   - apps/api/app/api/internal/audit-macro-drift — daily drift cron
 *
 * Design choices that pre-date this extraction (preserved for behavior parity):
 *   - Truncates body at 2500 chars + "… (truncated)" so we never blow past
 *     Slack's 4000-char limit even with markdown/code fences.
 *   - Wraps detail in triple-backtick code fence for monospace formatting.
 *   - Logs to stderr on failure, never throws — caller-safe.
 */

const DEFAULT_CHANNEL = "C0ASM3865AA";
const DETAIL_TRUNCATE_AT = 2500;
const TIMEOUT_MS = 3000;

export interface NotifySlackOptions {
  /** Optional tag prefixed to the message title, e.g. "ue-first" or "audit". */
  source?: string;
}

/**
 * Post a pre-formatted Slack message (mrkdwn) via chat.postMessage. Reads
 * SLACK_BOT_TOKEN and SLACK_ALERT_CHANNEL from process.env. Returns false
 * (no-op) when the token is unset — local dev / dry runs — and on any failure,
 * never throws. 3s timeout so a Slack outage never blocks the caller.
 *
 * Prefer `notifySlack` for alerts (adds a 🚨 + code fence). Use this directly
 * for digests/round-ups that need their own formatting.
 */
export async function postSlackMessage(
  text: string,
  options: { channel?: string } = {},
): Promise<boolean> {
  const token = process.env["SLACK_BOT_TOKEN"];
  if (!token) return false;

  const channel =
    options.channel ?? process.env["SLACK_ALERT_CHANNEL"] ?? DEFAULT_CHANNEL;
  const body = JSON.stringify({ channel, text });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
      },
      body,
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    if (!res.ok || !json?.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[postSlackMessage] post failed: HTTP ${res.status} ${json?.error ?? ""}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[postSlackMessage] post threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function notifySlack(
  title: string,
  detail: string,
  options: NotifySlackOptions = {},
): Promise<void> {
  const truncated =
    detail.length > DETAIL_TRUNCATE_AT
      ? detail.slice(0, DETAIL_TRUNCATE_AT) + "… (truncated)"
      : detail;
  const prefix = options.source ? `[${options.source}] ` : "";
  await postSlackMessage(
    `:rotating_light: *${prefix}${title}*\n\`\`\`${truncated}\`\`\``,
  );
}
