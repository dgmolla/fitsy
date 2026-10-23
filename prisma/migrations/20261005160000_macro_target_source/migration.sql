CREATE TYPE "MacroTargetSource" AS ENUM ('manual', 'automatic');

ALTER TABLE "MacroTarget" ADD COLUMN "source" "MacroTargetSource" NOT NULL DEFAULT 'manual';
