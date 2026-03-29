-- Switch to Supabase Auth: remove custom auth columns from User table.
-- User.id will now be the Supabase auth.users UUID (provided on insert, no default).

-- Drop unique indexes before dropping columns
DROP INDEX IF EXISTS "User_appleUserId_key";
DROP INDEX IF EXISTS "User_googleUserId_key";

-- Drop custom auth columns (Supabase manages these in auth.users)
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "appleUserId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "googleUserId";
