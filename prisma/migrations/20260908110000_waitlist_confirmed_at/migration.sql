-- Double opt-in for the launch waitlist. Account linkage alone does not
-- prove email ownership, so existing rows are not backfilled as confirmed.
-- New onboarding requests check provider ownership; other rows require
-- the explicit confirmation form in the email.
-- Cutover: every row that exists at migration time was collected under the
-- single opt-in rules. It keeps what it asked for (the launch notification)
-- via legacyConsent, but is NOT treated as confirmed: recurring marketing
-- email needs the double opt-in click. The DEFAULT true covers rows the
-- previous bundle inserts between this migration and the promotion; the
-- next release's contraction migration drops it.
ALTER TABLE "LaunchWaitlist" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "LaunchWaitlist" ADD COLUMN "legacyConsent" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "LaunchWaitlist_confirmedAt_idx" ON "LaunchWaitlist"("confirmedAt");
