/**
 * One-shot backfill: copy macros from MacroEstimate onto MenuItem.
 *
 * Pipeline now dual-writes macros to MenuItem at insert time
 * (scripts/pipeline-utils.ts), but historical rows have NULL on the new
 * columns. This script fills them in chunks of 50k rows and exits non-zero
 * if drift remains afterwards. Idempotent — the WHERE m.calories IS NULL
 * guard means re-running is a no-op once everything is filled.
 *
 * Run:
 *   set -a && source .env.local && set +a && npx tsx scripts/backfill-menu-item-macros.ts
 */

import { PrismaClient } from "@prisma/client";

const CHUNK_SIZE = 10_000;

async function main(): Promise<void> {
  // Use the direct (non-pooled) URL so big batch UPDATEs aren't subject
  // to PgBouncer's transaction-mode prepared-statement quirks and
  // shorter statement timeouts. Falls back to default URL otherwise.
  const directUrl = process.env["POSTGRES_URL_NON_POOLING"];
  const prisma = directUrl
    ? new PrismaClient({ datasources: { db: { url: directUrl } } })
    : new PrismaClient();
  const startMs = Date.now();

  console.log("[backfill] starting"); // eslint-disable-line no-console

  // Cursor by id (text). Walking forward via `id > $cursor ORDER BY id` keeps
  // each chunk bounded to a contiguous slice of the pkey, regardless of how
  // many rows are still NULL. Rows that already have macros are skipped via
  // `m.calories IS NULL` so re-runs are idempotent and cheap.
  let cursor = "";
  let total = 0;
  let chunk = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await prisma.$queryRaw<{ updated: number; max_id: string | null }[]>`
      WITH batch AS (
        SELECT id FROM "MenuItem"
        WHERE id > ${cursor} AND calories IS NULL
        ORDER BY id
        LIMIT ${CHUNK_SIZE}
      ),
      upd AS (
        UPDATE "MenuItem" m
        SET calories   = e.calories,
            "proteinG" = e."proteinG",
            "carbsG"   = e."carbsG",
            "fatG"     = e."fatG"
        FROM "MacroEstimate" e
        WHERE m.id IN (SELECT id FROM batch)
          AND e."menuItemId" = m.id
        RETURNING m.id
      )
      SELECT (SELECT count(*)::int FROM upd) AS updated,
             (SELECT max(id) FROM batch)     AS max_id
    `;
    const updated = result[0]?.updated ?? 0;
    const maxId = result[0]?.max_id ?? null;
    total += updated;
    console.log(`[backfill] chunk ${chunk}: updated ${updated} rows (running total ${total}, cursor=${maxId ?? "(empty)"})`); // eslint-disable-line no-console
    if (maxId === null) break; // batch was empty — nothing left
    cursor = maxId;
    chunk++;
  }

  console.log(`[backfill] backfill done: ${total} rows updated in ${Date.now() - startMs}ms`); // eslint-disable-line no-console

  // Verify — every MenuItem with a MacroEstimate must agree on macros.
  // Uses IS DISTINCT FROM so NULLs on either side count as drift.
  const driftRows = await prisma.$queryRaw<{ drift_count: bigint }[]>`
    SELECT count(*)::bigint AS drift_count
    FROM "MenuItem" m
    JOIN "MacroEstimate" e ON e."menuItemId" = m.id
    WHERE m.calories   IS DISTINCT FROM e.calories
       OR m."proteinG" IS DISTINCT FROM e."proteinG"
       OR m."carbsG"   IS DISTINCT FROM e."carbsG"
       OR m."fatG"     IS DISTINCT FROM e."fatG"
  `;
  const drift = Number(driftRows[0]?.drift_count ?? 0n);

  // Also check for MenuItems with no MacroEstimate (would be invisible to
  // the drift query above) — these shouldn't exist post-pipeline but a
  // null check here is cheap insurance.
  const orphanRows = await prisma.$queryRaw<{ orphan_count: bigint }[]>`
    SELECT count(*)::bigint AS orphan_count
    FROM "MenuItem" m
    WHERE m.calories IS NULL
  `;
  const orphans = Number(orphanRows[0]?.orphan_count ?? 0n);

  await prisma.$disconnect();

  console.log(`[backfill] verification: ${drift} drifted, ${orphans} still NULL`); // eslint-disable-line no-console

  if (drift > 0 || orphans > 0) {
    console.error(`[backfill] FAIL — drift=${drift}, orphans=${orphans}`); // eslint-disable-line no-console
    process.exit(1);
  }

  console.log("[backfill] verified clean — MenuItem.* matches MacroEstimate.* across all rows"); // eslint-disable-line no-console
}

main().catch((err) => {
  console.error("[backfill] fatal:", err); // eslint-disable-line no-console
  process.exit(1);
});
