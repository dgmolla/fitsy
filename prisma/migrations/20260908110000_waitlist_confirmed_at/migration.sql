-- Double opt-in for the launch waitlist. Onboarding rows are confirmed by
-- construction (Apple/Google verified the account email); website rows get
-- a confirmation email and are confirmed by its link.
ALTER TABLE "LaunchWaitlist" ADD COLUMN "confirmedAt" TIMESTAMP(3);
UPDATE "LaunchWaitlist" SET "confirmedAt" = "createdAt" WHERE "source" = 'onboarding' OR "userId" IS NOT NULL;
CREATE INDEX "LaunchWaitlist_confirmedAt_idx" ON "LaunchWaitlist"("confirmedAt");
