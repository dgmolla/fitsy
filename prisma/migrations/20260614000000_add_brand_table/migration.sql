-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "menuKind" TEXT NOT NULL DEFAULT 'restaurant';

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationCount" INTEGER NOT NULL DEFAULT 0,
    "menuKind" TEXT NOT NULL DEFAULT 'restaurant',
    "bestPair" DOUBLE PRECISION,
    "distinctive" BOOLEAN NOT NULL DEFAULT false,
    "detectionConf" TEXT,
    "macroSource" TEXT,
    "officialUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Restaurant_brandId_idx" ON "Restaurant"("brandId");

-- AddForeignKey
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
