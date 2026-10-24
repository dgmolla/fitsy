-- Coordinate with offline writer shutdown: old name-conflict writers cannot run after this cutover.
-- No menu IDs, saved references or estimates are replaced, deleted or guessed from a title.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE "MenuItem"
  ADD COLUMN "sourceItemId" TEXT,
  ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "MenuItem" DROP CONSTRAINT "MenuItem_restaurantId_name_key";
CREATE UNIQUE INDEX "MenuItem_restaurantId_sourceItemId_key"
  ON "MenuItem" ("restaurantId", "sourceItemId");
CREATE UNIQUE INDEX "MenuItem_restaurantId_name_fallback_key"
  ON "MenuItem" ("restaurantId", "name")
  WHERE "sourceItemId" IS NULL AND "retiredAt" IS NULL;
COMMIT;
