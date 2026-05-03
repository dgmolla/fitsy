-- Adds nullable Expo push token to User. Captured client-side after the
-- notification permission prompt (S-226). Nullable: token is only present
-- after the user grants permission and the device registers with Expo
-- push servers, so backfill is unnecessary.

ALTER TABLE "User"
  ADD COLUMN "pushToken" TEXT;
