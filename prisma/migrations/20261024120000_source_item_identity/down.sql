-- Offline recovery only, with writers stopped.
-- Refuse rollback once duplicate names exist; never delete products to restore an old schema.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_restaurantId_name_key" UNIQUE ("restaurantId", "name");
DROP INDEX "MenuItem_restaurantId_name_fallback_key";
DROP INDEX "MenuItem_restaurantId_sourceItemId_key";
ALTER TABLE "MenuItem" DROP COLUMN "sourceItemId", DROP COLUMN "retiredAt";
COMMIT;
