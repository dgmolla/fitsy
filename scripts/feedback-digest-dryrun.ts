/**
 * Dry run of the daily feedback round-up flow.
 *
 *   1. Seeds 2 sample Feedback rows (as POST /api/feedback would write them).
 *   2. Runs the EXACT query + formatter the cron route uses.
 *   3. Prints the Slack message — and, with --post, actually posts it via the
 *      real postSlackMessage wrapper (needs SLACK_BOT_TOKEN in env).
 *   4. Deletes the seeded rows so the DB is left untouched.
 *
 * Dry (no Slack call):
 *   set -a && . ./.env.local && set +a && npx tsx scripts/feedback-digest-dryrun.ts
 * Full run (real Slack post):
 *   set -a && . ./.env.local && set +a && npx tsx scripts/feedback-digest-dryrun.ts --post
 */
import { PrismaClient } from "@prisma/client";
import { postSlackMessage } from "../packages/shared/src/utils/notifySlack";
import { buildFeedbackDigest } from "../apps/api/lib/feedbackDigest";

const WINDOW_HOURS = 24;
const POST = process.argv.includes("--post");

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const seededIds: string[] = [];
  try {
    const user = await prisma.user.findFirst({ select: { id: true, email: true } });
    if (!user) {
      console.log("No users in DB — cannot seed sample feedback (FK). Aborting.");
      return;
    }
    console.log(`Using user ${user.email} (${user.id}) to attach sample rows.\n`);

    // 1. Seed — mirrors the route's prisma.feedback.create payload.
    const samples = [
      "The protein filter is great, but I wish I could save a default macro target.",
      "Found a bug: tapping a restaurant from search sometimes shows the wrong menu.",
    ];
    for (const message of samples) {
      const row = await prisma.feedback.create({
        data: {
          userId: user.id,
          userEmail: user.email,
          displayName: user.email.split("@")[0]!,
          message,
        },
        select: { id: true },
      });
      seededIds.push(row.id);
    }
    console.log(`Seeded ${seededIds.length} sample feedback rows.\n`);

    // 2. Same query the cron route runs.
    const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
    const rows = await prisma.feedback.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
      select: { userEmail: true, message: true, createdAt: true },
    });

    // 3. Same formatter the cron route uses.
    const text = buildFeedbackDigest(rows, { windowHours: WINDOW_HOURS });
    const banner = POST
      ? "─── Posting this to Slack (real env vars) ───"
      : "─── Slack message that WOULD post (dry run, nothing sent) ───";
    console.log(`${banner}\n`);
    console.log(text);
    console.log("\n────────────────────────────────────────────────────────────");
    console.log(`\n(${rows.length} row(s) in the last ${WINDOW_HOURS}h)`);

    // 3b. Real Slack post (only with --post).
    if (POST) {
      const hasToken = Boolean(process.env["SLACK_BOT_TOKEN"]);
      const channel = process.env["SLACK_ALERT_CHANNEL"] ?? "(default)";
      console.log(
        `\nSLACK_BOT_TOKEN present: ${hasToken} · channel: ${channel}`,
      );
      const ok = await postSlackMessage(text);
      console.log(ok ? "✅ Posted to Slack." : "❌ Slack post failed (see error above).");
    }
  } finally {
    // 4. Clean up only what we seeded.
    if (seededIds.length > 0) {
      await prisma.feedback.deleteMany({ where: { id: { in: seededIds } } });
      console.log(`\nCleaned up ${seededIds.length} seeded rows. DB unchanged.`);
    }
    await prisma.$disconnect();
  }
}

void main();
