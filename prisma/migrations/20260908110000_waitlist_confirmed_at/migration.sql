-- Double opt-in for the launch waitlist. Onboarding rows are confirmed by
-- construction (Apple/Google verified the account email); website rows get
-- a confirmation email and are confirmed by its link.
-- Cutover: every row that exists at migration time was collected under the
-- single opt-in rules. It keeps what it asked for (the launch notification)
-- via legacyConsent, but is NOT treated as confirmed: recurring marketing
-- email needs the double opt-in click. The DEFAULT true covers rows the
-- previous bundle inserts between this migration and the promotion; the
-- next release's contraction migration drops it.
ALTER TABLE "LaunchWaitlist" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "LaunchWaitlist" ADD COLUMN "legacyConsent" BOOLEAN NOT NULL DEFAULT true;
UPDATE "LaunchWaitlist" SET "confirmedAt" = "createdAt" WHERE "source" = 'onboarding' OR "userId" IS NOT NULL;
CREATE INDEX "LaunchWaitlist_confirmedAt_idx" ON "LaunchWaitlist"("confirmedAt");
