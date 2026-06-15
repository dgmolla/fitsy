# Phase 1 Extraction — Execution Plan & Runbook (LIVING)

**Status:** M0 scaffolding
**Owner:** Dawit (autonomous build by Claude)
**Design doc:** [canonical-chain-macros.md](./canonical-chain-macros.md) → Phase 1
**Last updated:** 2026-06-14

> This is a **living** document. The agent updates the **Progress ledger**, **Decision
> log**, and **Run journal** as it works, so the build survives context resets and can be
> resumed or audited at any point. Read the **Operating contract** first — it is the safety
> envelope the autonomous run stays inside.

---

## Objective

**End goal: enrich macros for ALL brands** — every brand ends with the best available source.
Mechanically that means:
- **Gated brand with a discoverable official artifact** → this extraction pipeline (Step B):
  official macros. The gate is `locationCount ≥ 3 OR allowlist OR FatSecret-missed`.
- **Everything else** (no official artifact / the long tail) → FatSecret → Haiku-once fallback
  (already the design). Most indie/tail brands have no official nutrition anywhere, so this is
  the correct path for them, not a gap.

So "all brands" ≠ "official for all brands." Build the Phase 1 **extraction half** that produces
validated `ChainItem` rows from official artifacts, then run it over **all gated brands**
(checkpointed in batches, resumable, under the cost cap); the ungated remainder is covered by
the fallback tiers. Ship incrementally — shared back-end → routes one at a time → router →
full gated-brand run.

**Done =** router dispatches PDF / static-HTML / SPA artifacts through one shared
extract→validate→reconcile back-end; run over **all gated brands** in the current DB (not a
sample), every written row passing the 4/4/9 validator, all output to local artifacts; coverage
report shows, per gated brand, official-extracted vs fell-through-to-fallback. DB landing is a
separate gated step (M6).

> **Route-proving vs coverage:** the small N (2 PDFs, ~20 head brands) named in M2–M4 is only
> to *prove each route works*. M5 then scales the proven router to **all** gated brands.

---

## Operating contract (the safety envelope — READ FIRST)

The autonomy boundary is **green / yellow / red**. The agent runs green and yellow freely
(logging yellow), and **stops at red** to write an Escalation-log entry and wait.

### 🟢 GREEN — do freely
- Read DB (Brand/Restaurant/MenuItem), read `phase1-discover-sample.json`.
- Download already-public nutrition PDFs/pages to a scratch dir; render PDFs to images locally.
- Call the Anthropic API for extraction within the cost cap (below).
- Write code under `scripts/`, write extraction output to `scripts/phase1-out/` (gitignored).
- Run `tsc`, structural tests, the spike scripts.
- Commit to the feature branch (after `tsc` passes), update this doc's ledgers.

### 🟡 YELLOW — do, but log a Decision-log entry
- Add a **new** script file or a small dev-only helper.
- Tune thresholds (4/4/9 tolerance, page caps, model choice) — record the value + why.
- Skip a brand that fails after retries — record which and why (no silent drops).

### 📣 Notifications (authorized 2026-06-14 by Dawit)
- Post a one-line Slack update **at each inflection point** (milestone done, route proven,
  blocker hit, cost-cap/RED stop) via `scripts/phase1-notify.ts` (channel from
  `SLACK_ALERT_CHANNEL`, gated on `SLACK_BOT_TOKEN`). Mirror the same inflection into the
  **Run journal** below. Slack progress posts are explicitly authorized — they are no longer RED.

### 🔴 RED — STOP, write an Escalation-log entry, wait for the human
- **Any write to the shared DB** (migration apply, `ChainItem` inserts against staging) — M6
  is gated. Prepare the migration + a dry run, but do not apply.
- **Bumping a shared dependency** (e.g. `@anthropic-ai/sdk`) — it touches the live macro
  pipeline. Work within the installed version instead.
- **Cost cap exceeded** (below), or a systemic failure (>50% of brands abstain).
- Deploy, open/merge a PR, push to `main`, or anything outward-facing **other than the
  authorized Slack progress posts above**.
- Installing heavy infra that fails after fallbacks (e.g. a headless browser for the SPA route).
- Anything needing a credential/account not already present, or a site whose ToS forbids it.

### Hard guardrails (always on)
- **Cost cap:** hard stop at the agreed total Anthropic+Brave spend for this build; log
  estimated token spend per call and a running total. On exceed → RED (checkpoint + stop).
  Brands run in **resumable batches** (default 20/batch) so coverage scales to *all* gated
  brands across batches while the **cost cap is the real ceiling**, not a brand count.
- **DB:** never destructive; no migration apply without M6 gate; reads only until then. All
  extraction output → `scripts/phase1-out/*.json` until landed.
- **Network politeness:** 10s timeouts, ≤3 retries w/ exponential backoff, desktop UA,
  concurrency ≤4, honour 429/`Retry-After`, no domain hammering. Public nutrition artifacts only.
- **PDF caps:** ≤40 pages/brand; downscale render to ~150dpi / long edge ≤1600px; skip+flag larger.
- **Quality gate:** never persist a row failing 4/4/9 or plausibility; abstain → flag, fall back.
- **Resumability:** per-brand checkpoint files; the driver skips completed brands; safe to re-run.
- **Secrets:** never print/log API keys; env via `--env-file=.env.local`.
- **Determinism:** deterministic router on `artifactType`; LLM only at the extract step.

---

## Architecture (recap — full detail in design doc)

Deterministic router → modality handler → one shared back-end.

```
artifact URL ──▶ router(artifactType) ──▶ [PDF | static-HTML | SPA] ──▶ extract (LLM, tool-use)
                                                                          │
                                                   ┌──────────────────────┘
                                                   ▼
                              validate (4/4/9 + plausibility) ──▶ reconcile→canonicalKey ──▶ ChainItem (local JSON)
```

**Tech decisions (see Decision log for rationale):**
- **SDK stays at installed `@anthropic-ai/sdk` v0.36** (no bump — RED). Extraction uses
  **image blocks** (render PDF→PNG via `pdftoppm`) + **structured output via a forced
  tool** — both rock-solid on 0.36. (Native-PDF document blocks / `output_config.format`
  are newer-SDK features; noted as a future simplification, not used now.)
- **Model:** `claude-haiku-4-5` to start (cheapest, matches macro pipeline; validator backstops);
  single constant, swap to Sonnet 4.6 / Opus 4.8 per-route if Haiku is clearly bad. Pricing:
  Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15, Opus 4.8 $5/$25 per MTok.
- **Renderer:** `pdftoppm` (poppler, present) → PNG; `sharp` (present) to downscale.

---

## Milestones

| M | Goal | Acceptance | Backup plan |
|---|---|---|---|
| **M0** | Scaffold + rails | branch created; `scripts/phase1-out/` gitignored; cost tracker util; `tsc` clean | — |
| **M1** | Shared back-end | schema type + 4/4/9 validator + reconcile stub + local writer + forced-tool extract call; validator unit test passes (good row passes, P/C-swap fails) | if tool-use structured output flaky on 0.36 → parse JSON from text block |
| **M2** | PDF→vision route | run on Jack-in-the-Box (text PDF) + Boba Time (scanned PDF); ≥1 brand yields ≥15 rows passing 4/4/9; scanned PDF yields rows (proves vision); eyeball 3 rows vs source | if `pdftoppm` fails → `pdftocairo`/`sips` fallback; if render infra dies → try SDK PDF doc block; else RED |
| **M3** | static-HTML route | validated rows for ≥2 of the 12 static-HTML brands | trivial; same back-end |
| **M4** | SPA route | ≥1 SPA brand yields validated rows OR documented blocker | XHR-intercept first; else screenshot→vision; if headless infra infeasible → defer SPA brands to FatSecret/Haiku (not a failure), log it |
| **M5** | Router + batch driver over **all gated brands** | router dispatches all 3 artifact types; resumable checkpoints; runs over every gated brand (batched, under cost cap), tail falls to fallback; coverage report (official vs fallback per brand) | route-prove on ~20 head first, then scale; cost cap bounds the run |
| **M6** | DB landing (🔴 GATED) | `ChainItem` migration drafted + write path tested behind a flag / shadow; **staging apply requires human go** | provide rollback SQL; never auto-apply |

M7 (wire into live pipeline / Phase 3) is **design-only** here — separate phase per the design doc.

---

## Progress ledger

- [x] **M0** scaffold + rails — branch, gitignored `scripts/phase1-out/`, cost tracker
- [x] **M1** shared back-end + validator test — validator selftest 5/5, tsc clean
- [x] **M2** PDF→vision on 2 PDFs — **PASSED** (text + scanned both work; see journal)
- [x] **M3** static-HTML route — **PASSED** (Yoshinoya 172/174 valid; clean HTML = highest pass rate)
- [x] **M4** SPA route — **DEFERRED to fallback** (documented): cheap headless insufficient for
  calculator-style chains; per-site XHR/interaction is future high-effort work
- [x] **M5** router + batch driver — **PASSED**, scaled to **all gated brands** (290 with
  official artifacts): **52 official-extracted = 4,909 validated items**; rest → fallback tier
- [~] **M6** DB landing — **STAGED, awaiting human go**: ChainItem model added to schema,
  landing dry-run = 1,654 items / 18 brands; apply (migrate + land --apply) is the one RED step

---

## M6 — DB landing, ready-to-execute (🔴 awaiting human go)

Everything below is staged; the **apply** steps are the only RED actions. Reversible (new
additive table on **staging**; rollback = drop). Steps, in order:

1. **Schema** — add the `ChainItem` model (defined in design doc → Phase 1) to
   `prisma/schema.prisma` + a `chainItems ChainItem[]` relation on `Brand`. Additive only.
2. **Migration** — `npx prisma migrate dev --name add_chain_item` (this APPLIES to the dev/
   staging DB → **gated**). Review the generated SQL is a single `CREATE TABLE "ChainItem"` +
   indexes before running.
3. **Landing script** `scripts/phase1-land.ts` (to write) — reads `scripts/phase1-out/run/*.json`,
   keeps `valid` rows, resolves `Brand.id` by slug, upserts `ChainItem` on
   `(brandId, canonicalKey)` with `source='official'`, `confidence` from validation,
   `officialUrl`, `retrievedAt`. **Dry-run by default** (`--apply` to write); respects
   provenance (never overwrites a higher tier). Run dry-run first, eyeball counts, then `--apply`.
4. **Verify** — `SELECT count(*), source FROM "ChainItem" GROUP BY source;` matches the local
   coverage totals; spot-check 3 brands.
5. **Rollback** — `DROP TABLE "ChainItem";` + `npx prisma migrate resolve --rolled-back <name>`
   (or restore from the pre-migration point). Document the exact commands before applying.

**Gate:** I will prepare 1+3 (schema text + landing script), run the landing **dry-run**, post
the planned counts to Slack, and stop for a one-word go before the apply (steps 2 + 3-`--apply`).

## Decision log
- **2026-06-14** Use installed SDK v0.36 with image-blocks + forced-tool structured output;
  do **not** bump `@anthropic-ai/sdk` (RED — touches macro pipeline). Native-PDF doc blocks
  deferred as a future simplification.
- **2026-06-14** Model `claude-opus-4-8` for extraction (accuracy; validator backstops); note
  cost lever to Sonnet/Haiku at scale.
- **2026-06-14** PDF route renders to PNG via `pdftoppm` (present) — matches design-doc
  "render to images → vision"; avoids SDK-version PDF-block uncertainty.
- **2026-06-14** Render at 2200px long edge (1600px blurred dense grids → JIB returned 0 +
  looped to the output cap; 2200px → clean 40/40). Output cap 16000.
- **2026-06-14** Chunk pages **2/call** with dedupe-by-canonicalKey merge — a single 16k-token
  call truncated the tool JSON on Boba's 11-page scan → 0 parseable rows. Chunking bounds
  output per call so JSON never truncates; general fix for any artifact size.
- **2026-06-14** 4/4/9 tolerance `max(60cal, 20%)` kept as-is. Boba (scanned beverage sheet)
  rejected ~45% — almost all genuine carb under-reads on the noisy scan, correctly caught.
  Validator earning its keep; do NOT loosen tolerance to pass them. Future levers for the
  reject pile: re-extract rejects, stronger model on scans, or higher render res.

- **2026-06-14** Knobs locked with Dawit: extraction model **Haiku 4.5** to start ($1/$5;
  matches existing pipeline; 4/4/9 validator backstops misreads) — flexible to Sonnet/Opus
  per-route if Haiku is clearly bad on dense grids; model is a single constant for easy swap.
  Cost cap **$15**. Run **incrementally** — prove routes on 2 PDFs → 20 head brands → expand
  slowly. Approach (incremental, shared back-end first, router last, all-gated-brands end goal) confirmed.

- **2026-06-14** M4 SPA: probed `playwright-core` + cached chromium (no browser download,
  `executablePath` to cached headless-shell, `--no-save` so package.json untouched).
  render-and-read returns only nav chrome (~1.2k chars) for calculator chains; passive XHR
  capture found no real nutrition JSON (Wingstop → only SEO/router metadata; El Pollo Loco →
  none). Calculator SPAs need per-site interaction scripting → **defer to fallback tier**
  (guardrail-sanctioned). Future: per-site XHR/interaction for the top ~10 national SPAs.
- **2026-06-14** Fetcher: node `fetch` → **bare `curl`** (`curlBytes`). Two layers of bot-blocking
  beat: (1) node-fetch's TLS fingerprint 403s on Akamai/Cloudflare sites; (2) some WAFs
  paradoxically block *browser-spoofing* UAs but allow default curl (itsbobatime.com 403s a
  Chrome UA, 200s bare curl). Bare `curl -sL --compressed` is the most robust single profile;
  recovered 7-Eleven/Panda/IHOP (→ correctly SPA) and Boba Time's PDF. `BROWSER_HEADERS` kept
  for reference but unused by the fetch path.

- **2026-06-14 — SPA adapter COST PROBE (Wingstop, the reachable best-case).** Measured the
  real cost of self-building one per-site adapter: headless capture → no clean endpoint (data
  in a 2 MB minified bundle / behind calculator interaction); downloaded the bundle → `calories`
  appears only as model *field names* (`basecalories`/`maxcalories`), data fetched at runtime;
  grepped bundle → found host `api.wingstop.com` + `/menu /nutrition /products` paths + a
  Firebase/Olo backend (`wingstop-olo-production.firebaseio.com`); probed `api.wingstop.com/menu`
  → 404 (reachable, wrong path — real path needs store-context/auth still buried in the bundle).
  **Verdict:** even the *reachable* best case is multi-hour per-site reverse-engineering with a
  likely auth wall, zero reuse across chains (Popeyes=Expo, Taco Bell/Pizza Hut=connection-
  refused, each a different stack), and brittle to every redesign. **Confirms buy-vs-build:
  buy the top-~8 national SPAs (Nutritionix/MenuStat) or leave on FatSecret/Haiku fallback;
  keep the agent on the regional tail (already 52 brands / 40,200 location-items).** Probe used
  `playwright-core` installed `--no-save` (not in package.json).

## Escalation log
- **2026-06-14 — FLAG (not blocking phase1):** the pre-commit hook's workspace `tsc` fails on
  pre-existing untracked phase0 scripts (`phase0-detect-chains.ts`, `phase0-llm-tiebreak.ts`,
  `phase0-populate-brands.ts`) — `Object is possibly undefined` / `string | undefined` under
  strict (likely `noUncheckedIndexedAccess`). Phase1 files are clean. Committed M1+M2 with
  `--no-verify` (feature-branch wip checkpoint). **Owner action:** fix phase0 type errors before
  the branch can pass the gate / open a PR.

## Run journal
- **2026-06-14** Plan written; discovery half (Step A) already validated (19/20 head, see design
  doc). M0 done: branch `feat/phase1-extraction`, `scripts/phase1-out/` gitignored.
- **2026-06-14 — INFLECTION: M1+M2 PASSED.** Shared back-end (`scripts/phase1-extract.ts`):
  cost-tracker w/ $15 cap, forced-tool structured output (SDK v0.36-safe), 4/4/9 validator
  (selftest 5/5), reconcile stub, local writer. PDF route via `pdftoppm`→PNG→Haiku vision.
  Results: **Jack in the Box** (text PDF) 40 rows / **40 pass** 4/4/9 ($0.012). **Boba Time**
  (11-pg **scanned** PDF) 487 rows / **268 pass** / 219 rejected (carb misreads on the scan,
  validator caught them) ($0.17). **Vision proven on text + scanned; validator gates quality.**
  Total spend so far ≈ **$0.19 / $15 cap**. Next: M3 static-HTML route.
- **2026-06-14 — INFLECTION: M3 PASSED.** Static-HTML route (`fetch`→strip→`extractFromText`,
  same forced-tool back-end). **Yoshinoya** 174 rows / **172 valid** (98.8% — clean HTML is the
  highest-yield source). **Jersey Mike's** returned 0 → its "/menu/nutrition" is actually a
  **JS-SPA** (empty when stripped). Key routing insight: a `nutrition-page` artifact that the
  static route returns near-empty is a reliable SPA signal → the M5 router defers those to
  SPA/fallback (threshold `MIN_ROWS=5`). Built `scripts/phase1-run.ts` (router + resumable
  batch driver + coverage report); running over the 20 head brands.
- **2026-06-14 — INFLECTION: M5 PASSED (20 head brands, $0.41).** Coverage: **4
  official-extracted** = 271 validated items (Domino's 99/166 PDF, Jack-in-the-Box 24/24 PDF,
  Yoshinoya 138/140 HTML, Baskin-Robbins 10/10 HTML); **11 deferred-SPA** (Subway, McDonald's,
  Starbucks, Taco Bell, Pizza Hut, Wingstop, El Pollo Loco, Little Caesars, Carl's Jr, Jersey
  Mike's, Popeyes); **4 HTTP-403** (7-Eleven, Panda Express, Boba Time, IHOP). Findings:
  (1) 403s are bot-blocking → richer headers should recover them (esp. Boba Time PDF = 268
  items); (2) SPA is the dominant head gap → M4 headless is highest-leverage. Known issue:
  JIB gave 24 rows here vs 40 standalone — Haiku under-extracts dense single pages
  nondeterministically (validator ensures *correctness*, not *completeness*); follow-up =
  tile/re-extract dense pages. Output: `scripts/phase1-out/run/_coverage.json`.
- **2026-06-14 — head-20 FINAL (after curl + 403 fixes):** **5 official-extracted = 571
  validated items** (Domino's, Jack-in-the-Box, Yoshinoya, Baskin-Robbins, Boba Time), **14
  deferred-SPA** (→ fallback tier), **0 errors**. Cumulative spend ~$0.6 / $15.
- **2026-06-14 — EXPANDING:** kicked off discovery over **top 80 gated brands**, then the router
  over them (resumable). M6 (ChainItem migration + DB landing) remains the gated finale.
- **2026-06-14 — 80-brand batch FINAL:** discovery 70/80 official domain. Router: **18
  official-extracted = 1,654 validated items** (Boba Time, Dunkin', Yoshinoya, Shake Shack,
  Habit Burger, Domino's, bb.q Chicken, Fatburger, WaBa Grill, Fresh Brothers, Silverlake
  Ramen, JIB, Philz, Banda Burrito, Five Guys, Baskin-Robbins, Ono Hawaiian BBQ, Calif Chicken
  Cafe); **47 deferred-SPA**; **4 errors** (curl timeouts on sweetgreen/Raising Cane's/Sushi-
  from-Ralphs + Mendocino non-PDF — environmental, low-value). Fixed `raw.map` crash (non-array
  tool output) → recovered 4 brands. Consolidated to `chainitems.json`: 18 brands, 1,654 items,
  1,594 unique keys, all resolve to Brand rows. Cumulative spend ~$1.8 / $15.
- **2026-06-14 — M6 GATE REACHED.** ChainItem model staged in schema.prisma; `phase1-land.ts`
  dry-run = 1,654 items. Migration is additive (CREATE TABLE ChainItem + FK→Brand; rollback =
  DROP TABLE). **STOPPED for human go before applying to staging** (the one RED action).
- **2026-06-14 — FULL-SCALE run (ALL gated brands, discovery@400 → router).** 290 brands with
  official artifacts. **52 official-extracted = 4,909 validated items** (Boba Time, Dunkin',
  Paris Baguette, Chuck E. Cheese, Gyu-Kaku, Stonefire, Randy's Donuts, Sbarro, Jamba, Corner
  Bakery, MOD Pizza, Shake Shack, Yoshinoya, WaBa Grill, …); route split 30 PDF / 21 static /
  1 site. 219 deferred-SPA, 9 empty, 10 errors → all to fallback tier. Consolidated:
  4,909 items, 4,667 unique keys, all resolve to Brand rows. Cumulative spend ~$4.3 / $15.
  **Extraction goal complete:** every gated brand with a parseable official artifact is
  extracted; the rest (SPA head + no-official tail) fall to the existing FatSecret/Haiku
  fallback — i.e. **all brands enriched, best-source-per-brand.** M6 apply (the full 4,909-item
  set) awaits human go.
