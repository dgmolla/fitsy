---
kanban-plugin: basic
---

<!-- last-updated: 2026-04-13 -->
<!-- spec: docs/engineering/specs/data-pipeline-v3.md -->

> **Spec:** All tasks in this sprint implement `docs/engineering/specs/data-pipeline-v3.md`. Read the full spec before starting any task. Key sections: Hex-Level Checkpointing, Failure Handling & Resilience, Scalability & Performance, Data Quality, Observability. The pipeline entry point is `scripts/preload.ts`.

## Backlog

### Wave 1 — Data integrity (ship before next preload run)

- [ ] **S-111** Non-food item filter — Add `validateItems()` with merchandise/utensil/zero-cal regex filters. Reject before persist. #backend #wave-1
- [ ] **S-112** Condiment filter — Filter items `cal < 30` AND name matches condiment patterns. #backend #wave-1
- [ ] **S-113** Transaction safety on persist — Wrap `persistItems()` delete+insert in `prisma.$transaction`. Rollback on failure. #backend #wave-1
- [ ] **S-114** HTML entity decode rerun — Rerun preload to apply existing `decodeHtml()` fix to 67 items. #backend #wave-1
- [ ] **S-115** Regression detection — Before persist: if new item count < 50% of existing and existing > 5, skip + log warning. `--force` override. #backend #wave-1
- [ ] **S-131** Remove name-only fallback — When all sources miss, skip the restaurant entirely instead of persisting a fake item with guessed macros. Emit restaurant event with `status: "skipped_no_source"`. Remove the name-only code path from `preload.ts`. #backend #wave-1
- [ ] **S-130** Selective restaurant rerun script — New `scripts/rerun.ts` that takes `--restaurants "Sqirl,Pine & Crane"` or `--place-ids "ChIJ_abc,ChIJ_def"`. Looks up existing restaurants in DB (skip discovery), runs full pipeline per restaurant (resolve -> fetch -> estimate -> validate -> persist), emits to Axiom. Extract `processRestaurant()` from `preload.ts` into shared module. Existing `rescrape-thin.ts` is similar but doesn't use the resolver chain or validation. Needed after Wave 1 data quality fixes to reprocess affected restaurants without rerunning full preload. #backend #wave-1

### Wave 2 — Reliability & observability

- [ ] **S-116** Retry with backoff — Wrap UE fetch, Haiku calls, Firecrawl scrape in retry (2 attempts, 1s/3s backoff). #backend #wave-2 ^dep-S-115
- [ ] **S-117** UE rate limiting — Add 500ms delay between UE fetches. On 403: backoff to 2s, retry once. #backend #wave-2
- [ ] **S-118** Name mismatch detection (all sources) — After scraping, compare scraped restaurant name against expected name (fuzzy match). If mismatch, set `nameMismatch: true` on restaurant event. Log-only, do not reject. Covers UE (JSON-LD store name), Yelp (page title), Brave website (page title). #backend #wave-2
- [ ] **S-119** Observability report script — New `scripts/pipeline-report.ts`. Queries Axiom for all events with a given runId, aggregates into coverage/source breakdown/errors/cost/data quality summary, prints clean report. Axiom is SOT, not in-memory state. #backend #wave-2
- [ ] **S-120** Axiom integration — Emit 4 event types to `fitsy-pipeline` dataset: `restaurant` (per restaurant, includes status/sourcesAttempted/sourcesFailed/nameMismatch/rejectedCount), `error` (real-time on failure), `cost_checkpoint` (per hex), `run` (end of pipeline). Errors emitted immediately, restaurant events batched per hex. Flush on exit. #backend #wave-2 ^dep-S-119
- [ ] **S-121** Macro math validation — Flag items where |cal - (p*4 + c*4 + f*9)| > 20%. Include in report. #backend #wave-2 ^dep-S-119
- [ ] **S-129** Update Axiom monitors — Switch Run failed, Cost overrun, Zero output from Threshold to MatchEvent. Add cost_checkpoint monitor. #backend #wave-2 ^dep-S-120

### Wave 3 — Source improvements

- [ ] **S-122** Brave Search for UE URL discovery — New `BraveSearchSource`. Query `"{name} {address} uber eats"` (address from Google Places for location precision — avoids wrong location for multi-location restaurants). Filter for `ubereats.com/store/` URLs. Replace Firecrawl search in resolver. #backend #wave-3 ^dep-S-120
- [ ] **S-123** Brave Search for website menu fallback — Query `"{name} {address} menu"`. Take top result matching restaurant domain or containing menu-like content. Replace Firecrawl search as final fallback. #backend #wave-3 ^dep-S-122
- [ ] **S-124** Update fallback chain — FatSecret -> UberEats -> Yelp -> Brave (website) -> name-only. Firecrawl retained for scraping known URLs only. #backend #wave-3 ^dep-S-123

### Wave 4 — Scale prep

- [ ] **S-125** Hex grid discovery — Implement `polygonToCells()` at H3 res 7 for LA metro. Replace single-point discovery. Dedup by `externalPlaceId`. #backend #wave-4 ^dep-S-124
- [ ] **S-126** Hex-level checkpointing — Checkpoint file at `scripts/cache/pipeline-checkpoint.json`. Track `completedHexes`. Skip completed hexes on restart. Batch-persist per hex. #backend #wave-4 ^dep-S-125
- [ ] **S-127** Incremental updates — Add `lastScrapedAt` + `menuHash` to Restaurant model. Skip if scraped within N days. `--force` override. #backend #wave-4
- [ ] **S-128** Parallelism tuning — Increase concurrency to 10-15 restaurants. Per-API semaphores (UE: 5, Haiku: 20, Brave: 15, Firecrawl: 3). #backend #wave-4

### Wave 5 — E2E validation (gate before LA scale run)

- [ ] **S-132** E2E pipeline test — single hex dry run. Run full v3 pipeline against 1 hex (Silver Lake). Verify: source fallback chain works, no name-only items persisted, validation filters active, regression guard works, all 4 Axiom event types land correctly, `pipeline-report.ts` renders from Axiom data, name mismatch flags present, cost matches projections (~$1 for ~200 restaurants), selective rerun via `rerun.ts` works. Kill mid-run + restart to confirm checkpoint skip. This is the go/no-go gate before scaling to 100 hexes. #backend #wave-5 ^dep-S-126 ^dep-S-128 ^dep-S-129 ^dep-S-130

## In Progress

## Done


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
