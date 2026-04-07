-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "dietaryTags" TEXT[];

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "priceLevel" TEXT,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "userRatingCount" INTEGER;
