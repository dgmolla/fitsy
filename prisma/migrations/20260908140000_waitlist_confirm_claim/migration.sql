-- Atomic claim for the double opt-in confirmation send (compare-and-set on
-- confirmSentAt), and a cutover default for confirmedAt: prod migrates
-- before the new bundle is promoted, so rows the OLD bundle inserts in that
-- window inherit the default and are grandfathered like the rest of the
-- single opt-in cohort. The new bundle sets confirmedAt explicitly (NULL for
-- website rows) and so is unaffected. Contract later: a follow-up migration
-- drops the default once the promotion has completed.
ALTER TABLE "LaunchWaitlist" ADD COLUMN "confirmSentAt" TIMESTAMP(3);
ALTER TABLE "LaunchWaitlist" ALTER COLUMN "confirmedAt" SET DEFAULT CURRENT_TIMESTAMP;
