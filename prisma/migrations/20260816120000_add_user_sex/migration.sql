-- Add optional biological sex to User for the Mifflin-St Jeor BMR term.
-- Nullable, no default — existing rows stay NULL and the calculators fall back
-- to the unisex midpoint (-78), so this is a safe additive migration.
ALTER TABLE "User" ADD COLUMN "sex" TEXT;
