-- Deleting an account unlinks its waitlist row instead of destroying it: the
-- row may be a website signup in its own right and carries the address-keyed
-- email opt-out. DELETE /api/user removes onboarding-only rows that never
-- opted out before deleting the user.
ALTER TABLE "LaunchWaitlist" DROP CONSTRAINT "LaunchWaitlist_userId_fkey";
ALTER TABLE "LaunchWaitlist" ADD CONSTRAINT "LaunchWaitlist_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
