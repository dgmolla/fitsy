-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN "dietaryOptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
