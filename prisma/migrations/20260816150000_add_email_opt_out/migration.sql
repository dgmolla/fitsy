-- Adds emailOptOutAt to suppress marketing email when user unsubscribes
ALTER TABLE "User" ADD COLUMN "emailOptOutAt" TIMESTAMP(3);
