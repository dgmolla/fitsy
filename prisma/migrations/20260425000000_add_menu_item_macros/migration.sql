-- Denormalize macros from MacroEstimate onto MenuItem to remove the
-- per-item index seek into MacroEstimate from the search hot path.
-- MacroEstimate stays as the audit log of estimation metadata
-- (confidence, source, reasoning, ingredientBreakdown, estimatedAt).
--
-- Columns are nullable here. Backfill happens in
-- scripts/backfill-menu-item-macros.ts; the read path stays on
-- MacroEstimate until the backfill audit reports zero drift, then
-- switches to MenuItem.* directly. A daily Vercel cron at
-- /api/internal/audit-macro-drift watches for divergence.

ALTER TABLE "MenuItem"
  ADD COLUMN "calories" INTEGER,
  ADD COLUMN "proteinG" DOUBLE PRECISION,
  ADD COLUMN "carbsG"   DOUBLE PRECISION,
  ADD COLUMN "fatG"     DOUBLE PRECISION;
