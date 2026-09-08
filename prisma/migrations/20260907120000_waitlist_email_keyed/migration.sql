-- LaunchWaitlist becomes an email-keyed list shared by onboarding ("Notify me")
-- and the fitsy.org waitlist form. Web signups have no account and no location,
-- so userId/lat/lng become nullable; email becomes the unique natural key.
CREATE TYPE "WaitlistSource" AS ENUM ('onboarding', 'web');

ALTER TABLE "LaunchWaitlist"
  ALTER COLUMN "userId" DROP NOT NULL,
  ALTER COLUMN "lat" DROP NOT NULL,
  ALTER COLUMN "lng" DROP NOT NULL,
  ADD COLUMN "source" "WaitlistSource" NOT NULL DEFAULT 'onboarding',
  ADD COLUMN "emailOptOutAt" TIMESTAMP(3);

-- Every existing row came from onboarding; the default backfilled them. The
-- default stays: the previous bundle keeps serving during the migrate/deploy
-- window and its insert omits "source".

-- Normalize before enforcing uniqueness. Keep the oldest row if two rows
-- collapse onto the same address (only possible via email case differences).
UPDATE "LaunchWaitlist" SET "email" = lower(trim("email"));
DELETE FROM "LaunchWaitlist" a
  USING "LaunchWaitlist" b
  WHERE a."email" = b."email"
    AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

CREATE UNIQUE INDEX "LaunchWaitlist_email_key" ON "LaunchWaitlist"("email");
