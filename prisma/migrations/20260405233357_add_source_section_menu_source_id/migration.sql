/*
  Warnings:

  - You are about to drop the column `photoSource` on the `Restaurant` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MacroEstimate" ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "section" TEXT;

-- AlterTable
ALTER TABLE "Restaurant" DROP COLUMN "photoSource",
ADD COLUMN     "menuSourceId" TEXT;
