-- UE-first pipeline rebuild (destructive).
--
-- Retires `externalPlaceId` in favor of `storeUuid` (UberEats store UUID), adds
-- `homeHex` for H3 batching, `brand` for chain grouping, and re-adds
-- `photoSource` (dropped in 20260405233357) for Google Places spend tracking.
--
-- Every Restaurant row (and its MenuItem / MacroEstimate / SavedItem children
-- via FK cascade) is wiped — post-migration the table is rebuilt from the UE
-- feed by `scripts/preload-ue-first.ts`. SavedItem.restaurantId and
-- SavedItem.menuItemId are ON DELETE SET NULL, so saved rows survive but point
-- to null restaurants/items until reseeded.
--
-- See docs/engineering/plans/ue-first-pipeline.md for context.

-- 1. Wipe restaurant-scoped data. CASCADE walks MenuItem → MacroEstimate.
TRUNCATE TABLE "Restaurant" CASCADE;
TRUNCATE TABLE "PipelineCompletedHex";

-- 2. Retire externalPlaceId (created as a UNIQUE INDEX in the init migration,
-- not a named constraint — drop the index, then the column).
DROP INDEX IF EXISTS "Restaurant_externalPlaceId_key";
ALTER TABLE "Restaurant" DROP COLUMN "externalPlaceId";

-- 3. Add UE-first columns
ALTER TABLE "Restaurant" ADD COLUMN "storeUuid"   TEXT NOT NULL;
ALTER TABLE "Restaurant" ADD COLUMN "homeHex"     TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "brand"       TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "photoSource" TEXT;

CREATE UNIQUE INDEX "Restaurant_storeUuid_key" ON "Restaurant"("storeUuid");
CREATE INDEX        "Restaurant_homeHex_idx"   ON "Restaurant"("homeHex");
