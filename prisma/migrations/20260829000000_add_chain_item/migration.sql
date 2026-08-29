-- CreateTable
CREATE TABLE "ChainItem" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "calories" INTEGER,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "servingSize" TEXT,
    "source" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "officialUrl" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChainItem_brandId_idx" ON "ChainItem"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "ChainItem_brandId_canonicalKey_key" ON "ChainItem"("brandId", "canonicalKey");

-- AddForeignKey
ALTER TABLE "ChainItem" ADD CONSTRAINT "ChainItem_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

