-- Bounded retries for the launch blast: a row that keeps failing at the
-- provider leaves the blast after MAX_NOTIFY_ATTEMPTS instead of alerting on
-- every daily tick. Additive.
ALTER TABLE "LaunchWaitlist" ADD COLUMN "notifyAttempts" INTEGER NOT NULL DEFAULT 0;
