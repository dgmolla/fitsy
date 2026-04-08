-- Migration: add_preload_unique_constraints
-- Purpose: Enforce one MenuItem per (restaurantId, name) and one MacroEstimate per menuItemId.
-- These constraints are required for idempotent preload upserts (S-101).

-- Pre-migration dedup: remove duplicate MacroEstimate rows (keep most recent per menuItemId).
-- This is a no-op if no duplicates exist, which is expected on the current staging DB.
DELETE FROM "MacroEstimate"
WHERE id NOT IN (
  SELECT DISTINCT ON ("menuItemId") id
  FROM "MacroEstimate"
  ORDER BY "menuItemId", "estimatedAt" DESC
);

-- Pre-migration dedup: remove duplicate MenuItem rows (keep most recently created per key).
DELETE FROM "MenuItem"
WHERE id NOT IN (
  SELECT DISTINCT ON ("restaurantId", name) id
  FROM "MenuItem"
  ORDER BY "restaurantId", name, "createdAt" DESC
);

-- Add unique constraint: one MenuItem per (restaurantId, name)
ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_restaurantId_name_key"
  UNIQUE ("restaurantId", name);

-- Add unique constraint: one MacroEstimate per menuItemId
ALTER TABLE "MacroEstimate"
  ADD CONSTRAINT "MacroEstimate_menuItemId_key"
  UNIQUE ("menuItemId");

-- Drop the now-redundant index on MacroEstimate(menuItemId)
-- (the unique constraint already creates an implicit index)
DROP INDEX IF EXISTS "MacroEstimate_menuItemId_idx";
