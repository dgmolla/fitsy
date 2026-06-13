-- Migration: macro_estimate_provenance
-- Purpose: Allow multiple MacroEstimate rows per MenuItem, one per source.
--
-- Previously MacroEstimate had a @unique on menuItemId (1:1 with MenuItem).
-- This migration transitions to a composite unique on (menuItemId, source) so
-- each source (merchant, fatsecret, ffn, haiku, llm, …) can store its own
-- estimate independently. The denormalized columns on MenuItem are updated by
-- the pipeline's winner-recompute step (using macroWinnerSqlOrder trust order)
-- so a lower-trust run never clobbers a higher-trust estimate.
--
-- Steps performed:
--   1. Backfill NULL source values to 'llm' (legacy rows had source nullable).
--   2. Make source NOT NULL with default 'llm'.
--   3. Drop the old single-row-per-item unique index.
--   4. Create the new composite unique index (menuItemId, source).
--
-- Today there is exactly one estimate per item, so (menuItemId, source) is
-- already unique after the backfill — the new index will not fail.

-- 1. Fill NULL source so the NOT NULL constraint won't reject existing rows.
UPDATE "MacroEstimate" SET "source" = 'llm' WHERE "source" IS NULL;

-- 2. Set the column default and make it NOT NULL.
ALTER TABLE "MacroEstimate" ALTER COLUMN "source" SET DEFAULT 'llm';
ALTER TABLE "MacroEstimate" ALTER COLUMN "source" SET NOT NULL;

-- 3. Drop the old per-item unique index (Prisma named it <Table>_<col>_key).
DROP INDEX IF EXISTS "MacroEstimate_menuItemId_key";

-- 4. Create the composite unique index: one estimate per (item, source).
CREATE UNIQUE INDEX "MacroEstimate_menuItemId_source_key" ON "MacroEstimate"("menuItemId","source");
