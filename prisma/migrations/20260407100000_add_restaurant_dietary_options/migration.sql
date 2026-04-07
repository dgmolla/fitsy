-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN "dietaryOptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- To roll back:
-- ALTER TABLE "Restaurant" DROP COLUMN "dietaryOptions";
