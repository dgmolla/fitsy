-- Additive and nullable: existing search and menu readers keep their current behavior.
ALTER TABLE "Restaurant" ADD COLUMN "openingHours" JSONB;
