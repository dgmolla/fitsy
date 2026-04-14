-- S-127: Add incremental update fields to Restaurant
-- lastScrapedAt tracks when menu was last fetched; menuHash detects actual changes
ALTER TABLE "Restaurant" ADD COLUMN "lastScrapedAt" TIMESTAMP(3);
ALTER TABLE "Restaurant" ADD COLUMN "menuHash" TEXT;
