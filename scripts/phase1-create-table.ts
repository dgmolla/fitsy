/**
 * Phase 1 — M6 step 3: create the ChainItem table (surgical, additive, idempotent).
 * Avoids `prisma migrate dev` (migration-history drift could trigger a destructive reset);
 * creates ONLY ChainItem + its indexes + FK to Brand. Touches nothing else.
 *
 * Rollback:  DROP TABLE "ChainItem";
 *
 *   npx tsx --env-file=.env.local scripts/phase1-create-table.ts
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const STMTS = [
  `CREATE TABLE IF NOT EXISTS "ChainItem" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChainItem_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ChainItem_brandId_canonicalKey_key" ON "ChainItem"("brandId","canonicalKey")`,
  `CREATE INDEX IF NOT EXISTS "ChainItem_brandId_idx" ON "ChainItem"("brandId")`,
  `DO $$ BEGIN
     ALTER TABLE "ChainItem" ADD CONSTRAINT "ChainItem_brandId_fkey"
       FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
];

async function main() {
  for (const s of STMTS) { await p.$executeRawUnsafe(s); }
  const r: any[] = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "ChainItem"`);
  console.log(`ChainItem table ready. current rows: ${r[0].n}`);
}
main().catch((e) => { console.error("CREATE ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
