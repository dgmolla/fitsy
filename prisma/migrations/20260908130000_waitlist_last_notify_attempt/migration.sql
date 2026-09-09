-- Retry at most once per cooldown: a row's failed attempts are spaced out
-- across ticks instead of being exhausted by one run's drain loop. Additive.
ALTER TABLE "LaunchWaitlist" ADD COLUMN "lastNotifyAttemptAt" TIMESTAMP(3);
