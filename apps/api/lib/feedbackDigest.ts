/**
 * Formats a daily feedback round-up into a Slack mrkdwn message.
 *
 * Kept pure (no DB / no network) so it's trivially testable and reusable by
 * both the cron route and the dry-run script. The route supplies rows already
 * filtered to the digest window and sorted newest-first.
 */

export interface FeedbackDigestRow {
  userEmail: string;
  message: string;
  createdAt: Date;
}

export interface FeedbackDigestOptions {
  /** Size of the look-back window, for the header. Defaults to 24. */
  windowHours?: number;
  /** Per-message truncation, to keep one noisy entry from dominating. */
  perItemMaxChars?: number;
}

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_PER_ITEM_MAX = 280;

/** "2026-06-06 14:23 UTC" — deterministic, locale-independent, testable. */
function formatTimestamp(d: Date): string {
  const iso = d.toISOString(); // 2026-06-06T14:23:05.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function truncate(s: string, max: number): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max - 1) + "…" : collapsed;
}

export function buildFeedbackDigest(
  rows: FeedbackDigestRow[],
  options: FeedbackDigestOptions = {},
): string {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const perItemMax = options.perItemMaxChars ?? DEFAULT_PER_ITEM_MAX;

  if (rows.length === 0) {
    return `:inbox_tray: *Feedback round-up — last ${windowHours}h*\nNo new feedback. :sparkles:`;
  }

  const header = `:inbox_tray: *Feedback round-up — last ${windowHours}h (${rows.length})*`;
  const items = rows.map((r, i) => {
    const when = formatTimestamp(r.createdAt);
    const msg = truncate(r.message, perItemMax);
    return `*${i + 1}.* _${r.userEmail}_ · ${when}\n> ${msg}`;
  });

  return `${header}\n\n${items.join("\n\n")}`;
}
