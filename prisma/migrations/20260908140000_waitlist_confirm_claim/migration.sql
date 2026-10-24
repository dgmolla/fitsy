-- Atomic claim for the double opt-in confirmation send (compare-and-set on
-- confirmSentAt). Additive.
ALTER TABLE "LaunchWaitlist" ADD COLUMN "confirmSentAt" TIMESTAMP(3);
