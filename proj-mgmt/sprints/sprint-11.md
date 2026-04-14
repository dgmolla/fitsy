---
kanban-plugin: basic
---

<!-- last-updated: 2026-04-14 -->
<!-- spec: docs/engineering/specs/data-pipeline-v3.md -->

> **Spec:** All tasks in this sprint implement `docs/engineering/specs/data-pipeline-v3.md`. Read the full spec before starting any task. Key sections: Hex-Level Checkpointing, Failure Handling & Resilience, Scalability & Performance, Data Quality, Observability. The pipeline entry point is `scripts/preload.ts`.

## Backlog

### Wave 9 — E2E validation

- [ ] **S-142** Mini-hex E2E integration test — Run full pipeline against a single small hex (res 8 or 9, ~20 restaurants). Verify: Overture discovery returns restaurants, hex assignment correct, source fallback chain works, checkpoint persisted in DB, resume skips completed hex, Axiom events emitted. #backend #wave-9 ^dep-S-141

### Wave 6 — Source reliability

- [ ] **S-133** Source reliability observability — Add per-source logging and Axiom detail so we can diagnose UE and other source failures. (1) Resolver: log source name + outcome + duration per attempt, don't swallow errors silently. (2) UberEatsSource: log which discovery step ran (cached/sitemap/brave/firecrawl) and why it failed (no URL, 403, no JSON-LD, name reject). (3) Axiom: replace bulk `sourcesFailed` with per-source `sourceResults` including status/reason/durationMs. (4) Dedup menu items by name before persist to fix unique constraint crash (Chick-fil-A). #backend #wave-6

## In Progress

## Done

### Wave 8 — Overture Maps integration

- [x] **S-136** Overture discovery service — Implement `downloadOvertureCache(bbox)` and `queryLocalParquet(cachePath, bbox)` using DuckDB to query Overture Maps GeoParquet on S3. Cache locally at `scripts/cache/overture-discovery.parquet`. 34 food categories, dedup by overtureId. 15 tests. #backend #wave-8 @completed(2026-04-14)
- [x] **S-137** Hex assignment from local parquet — `assignToHexes()` using h3-js `latLngToCell()`. Returns `Map<hexId, OvertureRestaurant[]>`. 6 tests. #backend #wave-8 ^dep-S-136 @completed(2026-04-14)
- [x] **S-138** PipelineCompletedHex migration — Add Prisma model with `@@unique([runId, hexId])` and `@@index([runId])` for DB-based hex checkpointing. Migration + 5 integration tests (skip in CI when no DB). #backend #wave-8 @completed(2026-04-14)
- [x] **S-139** Atomic hex persist + checkpoint — `persistHex()` wraps all per-restaurant persists + dietary options + checkpoint in single `prisma.$transaction` with 30s timeout. Shared helpers extracted to `pipeline-utils.ts`. 6 tests. #backend #wave-8 ^dep-S-138 @completed(2026-04-14)
- [x] **S-140** Resume-by-default — `getCompletedHexIds()` + `filterPendingHexes()`. Single query, O(1) set lookups. No --resume flag. 8 tests. #backend #wave-8 ^dep-S-139 @completed(2026-04-14)
- [x] **S-141** Remove Google Places + wire Overture into preload — Replaced `discoverRestaurants()` with Overture discovery → hex assignment → hex processing loop. Removed Google Places API key dependency. Date-based runId for resume. Dead code cleanup. #backend #wave-8 ^dep-S-137 ^dep-S-140 @completed(2026-04-14)

### Wave 5 — E2E validation (gate before LA scale run)

- [x] **S-132** E2E pipeline test — single hex dry run. Run full v3 pipeline against 1 hex (Silver Lake). Verify: source fallback chain works, no name-only items persisted, validation filters active, regression guard works, all 4 Axiom event types land correctly, `pipeline-report.ts` renders from Axiom data, name mismatch flags present, cost matches projections (~$1 for ~200 restaurants), selective rerun via `rerun.ts` works. Kill mid-run + restart to confirm checkpoint skip. This is the go/no-go gate before scaling to 100 hexes. #backend #wave-5 ^dep-S-126 ^dep-S-128 ^dep-S-129 ^dep-S-130 @completed(2026-04-13)

### Wave 4 — Scale prep

- [x] **S-125** Hex grid discovery — Implement `polygonToCells()` at H3 res 7 for LA metro. Replace single-point discovery. Dedup by `externalPlaceId`. #backend #wave-4 ^dep-S-124 @completed(2026-04-13)
- [x] **S-126** Hex-level checkpointing — Checkpoint file at `scripts/cache/pipeline-checkpoint.json`. Track `completedHexes`. Skip completed hexes on restart. Batch-persist per hex. #backend #wave-4 ^dep-S-125 @completed(2026-04-13)
- [x] **S-127** Incremental updates — Add `lastScrapedAt` + `menuHash` to Restaurant model. Skip if scraped within N days. `--force` override. #backend #wave-4 @completed(2026-04-13)
- [x] **S-128** Parallelism tuning — Increase concurrency to 10-15 restaurants. Per-API semaphores (UE: 5, Haiku: 20, Brave: 15, Firecrawl: 3). #backend #wave-4 @completed(2026-04-13)

### Wave 3 — Source improvements

- [x] **S-122** Brave Search for UE URL discovery — New `BraveSearchSource`. Query `"{name} {address} uber eats"` (address from Google Places for location precision — avoids wrong location for multi-location restaurants). Filter for `ubereats.com/store/` URLs. Replace Firecrawl search in resolver. #backend #wave-3 ^dep-S-120 @completed(2026-04-13)
- [x] **S-123** Brave Search for website menu fallback — Query `"{name} {address} menu"`. Take top result matching restaurant domain or containing menu-like content. Replace Firecrawl search as final fallback. #backend #wave-3 ^dep-S-122 @completed(2026-04-13)
- [x] **S-124** Update fallback chain — FatSecret -> UberEats -> Yelp -> Brave (website) -> name-only. Firecrawl retained for scraping known URLs only. #backend #wave-3 ^dep-S-123 @completed(2026-04-13)

### Wave 2 — Reliability & observability

- [x] **S-116** Retry with backoff — Wrap UE fetch, Haiku calls, Firecrawl scrape in retry (2 attempts, 1s/3s backoff). #backend #wave-2 ^dep-S-115
- [x] **S-117** UE rate limiting — Add 500ms delay between UE fetches. On 403: backoff to 2s, retry once. #backend #wave-2
- [x] **S-118** Name mismatch detection (all sources) — After scraping, compare scraped restaurant name against expected name (fuzzy match). If mismatch, set `nameMismatch: true` on restaurant event. Log-only, do not reject. Covers UE (JSON-LD store name), Yelp (page title), Brave website (page title). #backend #wave-2
- [x] **S-119** Observability report script — New `scripts/pipeline-report.ts`. Queries Axiom for all events with a given runId, aggregates into coverage/source breakdown/errors/cost/data quality summary, prints clean report. Axiom is SOT, not in-memory state. #backend #wave-2
- [x] **S-120** Axiom integration — Emit 4 event types to `fitsy-pipeline` dataset: `restaurant` (per restaurant, includes status/sourcesAttempted/sourcesFailed/nameMismatch/rejectedCount), `error` (real-time on failure), `cost_checkpoint` (per hex), `run` (end of pipeline). Errors emitted immediately, restaurant events batched per hex. Flush on exit. #backend #wave-2 ^dep-S-119
- [x] **S-121** Macro math validation — Flag items where |cal - (p*4 + c*4 + f*9)| > 20%. Include in report. #backend #wave-2 ^dep-S-119
- [x] **S-129** Update Axiom monitors — Switch Run failed, Cost overrun, Zero output from Threshold to MatchEvent. Add cost_checkpoint monitor. #backend #wave-2 ^dep-S-120

### Wave 1 — Data integrity (ship before next preload run)

- [x] **S-111** Non-food item filter — Add `validateItems()` with merchandise/utensil/zero-cal regex filters. Reject before persist. #backend #wave-1
- [x] **S-112** Condiment filter — Filter items `cal < 30` AND name matches condiment patterns. #backend #wave-1
- [x] **S-113** Transaction safety on persist — Wrap `persistItems()` delete+insert in `prisma.$transaction`. Rollback on failure. #backend #wave-1
- [x] **S-114** HTML entity decode rerun — Rerun preload to apply existing `decodeHtml()` fix to 67 items. #backend #wave-1
- [x] **S-115** Regression detection — Before persist: if new item count < 50% of existing and existing > 5, skip + log warning. `--force` override. #backend #wave-1
- [x] **S-131** Remove name-only fallback — When all sources miss, skip the restaurant entirely instead of persisting a fake item with guessed macros. Emit restaurant event with `status: "skipped_no_source"`. Remove the name-only code path from `preload.ts`. #backend #wave-1
- [x] **S-130** Selective restaurant rerun script — New `scripts/rerun.ts` that takes `--restaurants "Sqirl,Pine & Crane"` or `--place-ids "ChIJ_abc,ChIJ_def"`. Looks up existing restaurants in DB (skip discovery), runs full pipeline per restaurant (resolve -> fetch -> estimate -> validate -> persist), emits to Axiom. Extract `processRestaurant()` from `preload.ts` into shared module. Existing `rescrape-thin.ts` is similar but doesn't use the resolver chain or validation. Needed after Wave 1 data quality fixes to reprocess affected restaurants without rerunning full preload. #backend #wave-1


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
