-- Double opt-in for the launch waitlist. Onboarding rows are confirmed by
-- construction (Apple/Google verified the account email); website rows get
-- a confirmation email and are confirmed by its link.
-- Cutover: every row that exists at migration time was collected under the
-- single opt-in rules and has no code path that could ever confirm it, so it
-- is grandfathered as confirmed at its creation time rather than orphaned.
ALTER TABLE "LaunchWaitlist" ADD COLUMN "confirmedAt" TIMESTAMP(3);
UPDATE "LaunchWaitlist" SET "confirmedAt" = "createdAt" WHERE "confirmedAt" IS NULL;
CREATE INDEX "LaunchWaitlist_confirmedAt_idx" ON "LaunchWaitlist"("confirmedAt");
