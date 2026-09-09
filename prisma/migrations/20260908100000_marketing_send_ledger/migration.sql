-- Address-keyed ledger of marketing sends. Replaces the self-creating
-- "_marketing_send" (edition, user_id) table used by the weekly cron.
-- Expand step only: history is copied in and the legacy table is left in
-- place (nothing writes to it any more); a later migration contracts it
-- once the ledger-backed cron has run in production.
CREATE TABLE "MarketingSend" (
    "id"       TEXT NOT NULL,
    "email"    TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "step"     TEXT NOT NULL,
    "sentAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingSend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketingSend_email_campaign_step_key" ON "MarketingSend"("email", "campaign", "step");
CREATE INDEX "MarketingSend_email_sentAt_idx" ON "MarketingSend"("email", "sentAt");

-- Carry over weekly-edition history so nobody receives an edition twice.
-- The step is week-stamped exactly like the cron builds it
-- (<edition>:w<weeks since Mon 2026-01-05 UTC>, see weekIndexForDate in
-- apps/api/lib/emailTemplates.ts) so the carried-over rows actually match.
-- The legacy table only exists where the weekly cron has already run.
DO $$
BEGIN
  IF to_regclass('"_marketing_send"') IS NOT NULL THEN
    INSERT INTO "MarketingSend" ("id", "email", "campaign", "step", "sentAt")
      SELECT md5(lower(u."email") || ':weekly:' || s.step), lower(u."email"), 'weekly', s.step, s.sent_at
        FROM (
          SELECT m.user_id,
                 COALESCE(m.sent_at, CURRENT_TIMESTAMP) AS sent_at,
                 m.edition || ':w' || floor(
                   (extract(epoch FROM COALESCE(m.sent_at, CURRENT_TIMESTAMP))
                    - extract(epoch FROM timestamptz '2026-01-05 00:00:00+00')) / 604800
                 )::text AS step
            FROM "_marketing_send" m
        ) s
        JOIN "User" u ON u."id" = s.user_id
      ON CONFLICT ("email", "campaign", "step") DO NOTHING;
  END IF;
END $$;

-- isEmailOptedOut compares lower("email") on User for every marketing send;
-- the plain unique index cannot serve that predicate.
CREATE INDEX "User_email_lower_idx" ON "User" (lower("email"));
