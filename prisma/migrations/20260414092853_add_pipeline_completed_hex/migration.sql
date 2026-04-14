-- CreateTable
CREATE TABLE "PipelineCompletedHex" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "hexId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineCompletedHex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineCompletedHex_runId_idx" ON "PipelineCompletedHex"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineCompletedHex_runId_hexId_key" ON "PipelineCompletedHex"("runId", "hexId");
