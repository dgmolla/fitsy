-- AlterTable: add googleUserId to User for Google Sign In
ALTER TABLE "User" ADD COLUMN "googleUserId" TEXT;

-- CreateIndex: unique constraint on googleUserId
CREATE UNIQUE INDEX "User_googleUserId_key" ON "User"("googleUserId");
