/**
 * Formats user feedback for Slack, in two shapes:
 *
 *   - `buildFeedbackAlert`  — one message per submission, posted the moment a
 *     user hits "Send" (from POST /api/feedback). Carries a one-click
 *     `mailto:` reply pre-filled with the "can I call you for 10 min?" ask, so
 *     the 24h personal-reply rule in docs/product/feedback-triage.md costs one
 *     click, not a context switch.
 *   - `buildFeedbackDigest` — the daily round-up (cron), the safety net for
 *     anything missed in real time. Same reply links.
 *
 * Kept pure (no DB / no network) so it's trivially testable and reusable by
 * both routes and the dry-run script.
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
/** Keep the quoted excerpt in the reply short enough for a sane mailto URL. */
const REPLY_QUOTE_MAX = 200;

/** "2026-06-06 14:23 UTC" — deterministic, locale-independent, testable. */
function formatTimestamp(d: Date): string {
  const iso = d.toISOString(); // 2026-06-06T14:23:05.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function truncate(s: string, max: number): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max - 1) + "…" : collapsed;
}

/**
 * Pre-filled reply. The body quotes their note back (so they remember what
 * they said) and asks for a 10-minute call: at <100 users, calls are where
 * the real product insight is. Founder edits before sending, this is a draft.
 */
export function buildReplyMailto(userEmail: string, message: string): string {
  const subject = "Re: your Fitsy feedback";
  const body = [
    "Hi,",
    "",
    "Thanks for the note, I read every one personally:",
    "",
    `> ${truncate(message, REPLY_QUOTE_MAX)}`,
    "",
    "Would you be up for a 10-minute call this week? I'd love to hear how you're using Fitsy and what's getting in the way. Reply with a couple of times that work and I'll send an invite.",
    "",
    "Dawit",
    "Founder, Fitsy",
  ].join("\n");
  return `mailto:${encodeURIComponent(userEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Slack mrkdwn link: `<url|label>`. */
function replyLink(userEmail: string, message: string): string {
  return `<${buildReplyMailto(userEmail, message)}|Reply>`;
}

/** Real-time, one message per submission. */
export function buildFeedbackAlert(row: FeedbackDigestRow): string {
  const when = formatTimestamp(row.createdAt);
  const msg = truncate(row.message, DEFAULT_PER_ITEM_MAX);
  return [
    `:speech_balloon: *New feedback* from _${row.userEmail}_ · ${when}`,
    `> ${msg}`,
    `${replyLink(row.userEmail, row.message)} within 24h · ask for a 10-min call`,
  ].join("\n");
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

  const header = `:inbox_tray: *Feedback round-up — last ${windowHours}h (${rows.length})*\n_Every item below should already have a personal reply. If not, click Reply._`;
  const items = rows.map((r, i) => {
    const when = formatTimestamp(r.createdAt);
    const msg = truncate(r.message, perItemMax);
    return `*${i + 1}.* _${r.userEmail}_ · ${when} · ${replyLink(r.userEmail, r.message)}\n> ${msg}`;
  });

  return `${header}\n\n${items.join("\n\n")}`;
}
