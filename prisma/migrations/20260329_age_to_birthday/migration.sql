-- AlterTable: replace age (Int) with birthday (DateTime)
ALTER TABLE "User" DROP COLUMN "age";
ALTER TABLE "User" ADD COLUMN "birthday" TIMESTAMP(3);
