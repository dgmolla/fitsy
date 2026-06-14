/**
 * Phase 1 — inflection-point Slack notifier.
 * Posts a one-line progress update to the alert channel (gated on SLACK_BOT_TOKEN).
 * Used to surface milestone completions / blockers during the autonomous build,
 * per the runbook's Notifications discipline.
 *
 *   npx tsx --env-file=.env.local scripts/phase1-notify.ts "message text"
 */
import { postSlackMessage } from "@fitsy/shared";

const text = process.argv.slice(2).join(" ");
if (!text) { console.error("usage: phase1-notify.ts <message>"); process.exit(1); }

postSlackMessage(`:test_tube: *Phase 1 extraction* — ${text}`)
  .then((ok) => console.log(ok ? "slack: posted" : "slack: skipped (no SLACK_BOT_TOKEN or post failed)"))
  .catch((e) => { console.error("slack error:", e.message); });
