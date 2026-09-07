-- Adds lastEventAt so the RevenueCat webhook can drop stale/duplicate events
ALTER TABLE "Subscription" ADD COLUMN "lastEventAt" TIMESTAMP(3);
