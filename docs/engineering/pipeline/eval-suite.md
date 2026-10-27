**TL;DR:** The measured extension freezes 402 curated and 4,040 bulk cases while preserving the complete original v1 population.

# Restaurant matching and macro evaluation suite

This suite evaluates matching and nutrition estimation separately through pluggable interfaces.
It is an offline research artifact and does not enable a production matching or estimation path.
Spec owner: the execution owner of [#557](https://github.com/dgmolla/fitsy/issues/557).

```mermaid
flowchart LR
  A[Verified repo facts and inspected official PDF rows] --> B[Explicit curated scenarios]
  A --> C[Bulk published rows and captured UE bindings]
  B --> S[Grouped stratified split]
  C --> S
  S --> D[Dev: iterate and compare]
  S --> H[Locked holdout and SHA-256 manifest]
  D --> R[Pluggable runner]
  H --> V[Verify hashes and append run receipt]
  V --> R
  R --> M[Failure-inclusive metrics and durable results]
  R --> J[Explicit live Jev: exclusive additive budget]
```

## Run

Install dependencies with `npm ci` in the repository root.
No command loads environment files, connects to any database, or imports an Anthropic client.
The sole network path is an explicitly selected Jev adapter sending to `https://api.typesafe.ai/v1/systemone`.
Do not configure or connect to production Supabase for this work.

```sh
# Entirely offline, matching only; exact has no estimator.
# This is also the simplest end-to-end smoke test of the real consumer.
npm run eval:suite -w scripts -- --methods=exact --split=dev --tier=both

# Explicit live comparison on dev, in a committed clean source checkout.
# Configure TYPESAFE_API_KEY only in the invoking process; never print the key.
npm run eval:suite -w scripts -- --methods=exact,jev-v3 --split=dev --tier=both --live

# Verify fixtures and the case list without scoring either split.
node --import tsx scripts/eval/suite/build.ts --check
node --import tsx scripts/eval/suite/list-cases.ts --check

npm run lint -w scripts
npm run type-check -w scripts
npm test -w scripts -- --runInBand --runTestsByPath eval/suite/suite.test.ts
```

For the measured extension, run only the frozen affected-dev selection:

```sh
npm run eval:suite -w scripts -- --methods=exact,jev-v3 --split=dev --tier=both --cases=measured/dev-selection.json --live
```

`--cases` accepts a source-relative selection JSON only on dev and rejects unknown, duplicate or out-of-tier IDs before collection.
The recorded selection contains all 295 new dev cases and 91 original dev matching cases whose candidate projection acquires source tags.
It excludes all unaffected old work and all holdout cases.
All 386 eligible cases fit the conservative remaining reservation budget without sampling.

`--methods` selects a comma-separated set; `--split` accepts `dev` or `holdout`; `--tier` accepts `curated`, `bulk`, or `both`.
Haiku and Qwen names are documented, disabled stubs and cannot make requests.
No actual holdout evaluation is authorized for the construction and baseline work recorded here.
Tests use an unrelated Toy Chain temporary fixture to exercise holdout logging; they never score repository holdout cases.

## Ground truth and provenance

All numerical expectations come from official published rows or independently transcribed official manufacturer labels.
The baseline inputs and labels are frozen before model execution; no model estimate supplies ground truth.
`data/rows.json` retains each canonical ID, chain, published name, section, full serving, region, exact four-macro tuple, source URL, source hash, page, and locator.
Each JSONL case has an ID, task, tier, split, group, input, expected output, category, chain, one-line why, origin, source URL/page, and matching candidate IDs when applicable.
Units are kcal for calories and grams for protein, total carbohydrate, and total fat.
Published decimals remain intact.

| Chain | Verified servings used | Provenance and scope |
| --- | ---: | --- |
| WaBa Grill | 88 | Previously audited official PDF and manufacturer labels from `jev-macro/truth.json`; original source and page retained. |
| Yoshinoya | 71 | Previously audited official PDF and manufacturer label; all 31 fountain/craft drink rows excluded. |
| Wahoo's Fish Taco | 87 | Original 32 rows visually checked on pages 62, 63, 70 and 80; 55 additional rows independently checked against exact physical-page text and column order in the measured extension. |
| Claim Jumper | 38 | Original 36 rows visually checked on pages 1, 7, 8 and 14; two additional rows source-checked in the measured extension; the whole chain remains holdout-only. |
| Old Spaghetti Factory | 54 | Individually checked official labelled HTML cards with exact section, serving and four-macro fields; no invented PDF page. |

The original 68 added PDF rows have independently entered observed tuples in `sources/pdf-checks.json`.
They were compared row by row with the fetched PDF, its inspected column headers, and PR [#554](https://github.com/dgmolla/fitsy/pull/554)'s extraction, read from the fetched `pr554` ref.
`source.page` always means the one-based physical PDF page; Wahoo's printed page is one less because its contents page counts physically.
The label sources name the manufacturer product-label page rather than inventing a PDF page number.
Inspected page text and hashes are retained in `sources/pdf-pages.json`; original PDF bytes remain reproducible from the recorded official URLs and raw hashes.

| PDF | Raw SHA-256 |
| --- | --- |
| [Wahoo's](https://www.wahoos.com/wp-content/uploads/2026/06/Wahoos-Nutritional-info-6-26.pdf) | `105423afbefb12ae06fd368596ec974a8ce9935b73c474663432c54f5fee3c21` |
| [Claim Jumper](https://www.claimjumper.com/files/nutrition-guide-pdf.pdf) | `e754c6727379534fec0fff36055933c13730dbc2cc9adb4f5f279cb01f766835` |

Recheck downloaded `wahoos.pdf` and `claim-jumper.pdf` without network or credentials:

```sh
python3 -B scripts/eval/suite/sources/verify-pdfs.py --pdf-dir=/path/to/downloaded-pdfs
```

This is agent source verification, not a claim that the restaurants' published values are laboratory measurements or human-approved truth.
Claim Jumper is an older official document with unresolved current-menu availability; cases target exactly that document's published serving and make no current-availability claim.
The suite does not rescale or correct unusual source facts with 4/4/9 calculations.

## Curated and bulk tiers

[The curated list](eval-suite-cases.md) shows all 224 matching and 178 macro cases for human review.
The original v1 population contains 160 of each; the measured extension adds 64 matching and 18 macro cases.
`sources/curation.json` is the explicit scenario plan, with chain quotas and deliberate category coverage fixed before collection.
Half of the original 160 curated matching cases are synthetic challenges changing chain, explicit modifiers, configuration completeness, or candidate availability.
Their source citations establish the unchanged reference recipe; they do not claim an official number for an unpublished modified dish.
A no-rice bowl or add-avocado item returns NO MATCH when its modified row is absent; no subtraction or invented modified macro truth occurs.

The original bulk population includes one macro case for each of its 227 verified rows and one contextual multi-candidate matching case per row.
The measured extension brings the reference table to 338 rows and retains one bulk macro case per row.
It additionally contains 81 captured Uber Eats variants with independent official-row bindings, each with a positive case, up to 24 same-chain negatives and 16 cross-chain negatives ranked by name-token overlap.
The captured input text is preserved except complete nutrition-bearing marketing sentences are removed.
Unresolved or multiply bound observations are excluded.
Equal macro-vector same-chain rows are not used as negative pairs because they may represent equivalent published components under different headings.
Cross-chain identical or near-identical names and same-chain size/recipe variants are explicit negative categories.
Published-row and synthetic inputs are clearly tagged and must not be reported as captured UE traffic.
The original bulk tier has 3,415 matching cases and 227 macro cases, including two additional cross-chain identical-published-name negatives.
The extended bulk tier has 3,702 matching cases and 338 macro cases.

Repeated candidate pairs share inputs and source servings, so thousands of cases do not constitute thousands of independent dishes.
Use per-category and per-chain results and retain case counts and sampling identity when comparing methods.
An overall matching pass rate is sensitive to the many negative pairs; recall and wrong-match count must accompany it.

## Splits and holdout discipline

| Tier / task | Dev | Locked holdout | Holdout share |
| --- | ---: | ---: | ---: |
| Curated matching | 143 | 81 | 36.2% |
| Curated macro | 112 | 66 | 37.1% |
| Bulk matching | 2,538 | 1,164 | 31.4% |
| Bulk macro | 214 | 124 | 36.7% |

Split assignment groups all cases of a canonical serving across both tiers and all captured aliases.
Seven explicit reviewed equivalence groups in `sources/serving-groups.json` also bind identical named, sized components across combo and side headings, without equating unrelated dishes by macro values alone.
It stratifies by chain, primary published-serving category, and whether an independently reviewed captured binding exists.
The fixed `suite-v1` hash seed selects 35% in captured strata and 21% in published-only strata, with the entire 36-row Claim Jumper chain assigned to holdout.
Those original weights balance repeated UE pairs and macro rows; they were chosen from case counts before any provider result.
The measured extension preserves all original assignments and separately stratifies new captured families, as described below.
Small strata use deterministic rounding, so every rare category/chain combination cannot appear in both splits.
Candidate distractors stay within the target serving's split, keeping the holdout-only chain out of dev prompts.

Tune only on dev.
Run holdout rarely, after freezing a method and an explicit evaluation plan.
Every actual holdout invocation verifies `holdout.sha256` and appends start and terminal receipts to `results/holdout-runs.jsonl`, including failed checksum or preflight attempts.
The three pinned files are both holdout JSONLs and the shared reference-row table.
Each receipt binds run ID, UTC time, source head, options, and, on completion, checksum and selection identities.
Keep that log additive and retain interrupted starts as evidence.

Never add case-specific rules, prompt demonstrations, or examples derived from holdout.
Expected-output changes, exclusions that change the frozen test population, or checksum updates need human review in a versioned PR.
The generator's `--initialize` refuses any existing frozen outputs; normal `--check` is read-only.
Before the first release, independent review corrected equivalent-serving membership and one explicit modifier scenario; canonical reference IDs and every numerical macro expectation remained unchanged, and original candidate history is retained in Git.
Add fresh official cases periodically, especially independent chains and real observed failures, and version the split rather than silently refreshing the old holdout.
This repository-visible holdout is protected by process and checksums, not a claim of cryptographic secrecy from developers.

## Measured-menu extension: 2026-10-26

The human authorized this versioned seed addition and checksum refresh on PR #558.
The read-only source checkout is `data/pdf-match-scope` at `3e8f13afb05f8aba0fc10744484c5d1d023fc6ce`.
`sources/measured/` copies the hash-pinned 259-item measurement and three successful UE captures; no source checkout files are modified.
The existing PDF-finder snapshots already match that checkout byte for byte.

| Chain | Measured UE items | Admitted bulk UE seeds | Excluded observations |
| --- | ---: | ---: | ---: |
| Wahoo's | 79 | 61 | 18 |
| Claim Jumper | 74 | 20 | 54 |
| Old Spaghetti Factory | 106 | 95 | 11 |
| Total | 259 | 176 | 83 |

The explicit admission plan precedes evaluation and records every exclusion individually in the fixture manifest.
Each admitted observation supplies one bulk matching case; the curated tier selects three per chain/category stratum plus every admitted multi-row, catering-title and gluten-sensitive-title hit.
New published rows also receive bulk matching and macro cases; eight macros per chain, or all if fewer, are chosen by deterministic category rotation for curated coverage.
This adds 480 cases: 64 curated matching, 18 curated macro, 287 bulk matching and 111 bulk macro.
No captured nutrition claim, model answer, arithmetic scaling or inferred modifier becomes numerical truth.

The 17 OSF observations matching multiple raw source rows are all admitted as exact-row choices or candidate-relative negatives.
Seven gluten-sensitive exact-title hits and 12 catering lowercase/trim hits are included, with overlap in those 17 collisions.
Regular, lunch, child and gluten-sensitive portions stay distinct even when their names match.
The gluten-sensitive Rich Meat Sauce case selects the differently named official Gluten Sensitive Meat Sauce card; the ordinary identically named rows are distractors.
Catering garlic bread is excluded because its serving may equal the appetizer; catering context alone cannot prove otherwise.
The extra Claim Jumper Baked Potato collision is excluded after inspecting page 7: the first lunch row includes indented toppings, while its subrow is plain, and the UE item does not resolve the applicable portion.
Unverified small/snack, large/share, recipe, side and regional equivalences are also excluded.

NO MATCH means none of the supplied verified candidates identifies the captured configuration.
For the 74 observations labelled missing-from-snapshot or UE-only, negatives test explicit supplied candidates and make no claim of exhaustive original-document absence.
Unselected combos test complete configured rows or components without guessing choices.
Captured names and descriptions retain menu wording, while prices, ratings, images and nutrition-bearing text are removed from provider inputs.

`verify-sources.py` independently reads the official labelled HTML cards and physical PDF pages, checks source hashes, verifies exact row text and established numeric column order, and compares all four macros.
It checks 118 rows against 28 PDF pages and labelled HTML cards, with source observations in `row-checks.jsonl` and reproducible page evidence.

```sh
python3 -B scripts/eval/suite/sources/measured/verify-sources.py --source-dir=/path/to/official-source-bytes
```

The directory contains `wahoos.pdf`, `claim-jumper.pdf` and `old-spaghetti-factory.html` with the hashes recorded in their original source manifests.
`--initialize` creates source-check artifacts only when absent; normal verification never rewrites them.

`sources/measured/v1-lock.json` pins all four original case partitions and reference bytes at the pre-extension head.
The generator validates those complete original cases before appending seeds, so no old input, expected output, candidate set or split can silently change.
New collision families use the original `suite-v1` seed and 35% captured chain/category strata, inherit an existing split when touching an original serving, and keep every Claim Jumper row in holdout.
Observations without a reference target group by captured chain/name; identical observations across contexts remain on one split.
Every candidate stays within its case's split.
The extended reference table and both holdout partitions receive fresh SHA-256 pins; neither holdout partition has been scored.
The explicitly authorized `--extend-measured` generator accepts only the pinned original bytes or already-generated extension bytes and refuses divergent frozen files.

## Adapter contract

`types.ts` exports `Matcher` (`item + candidate rows -> match ID | none | abstain, confidence`) and `Estimator` (`item -> calories/protein/carbs/fat | null`).
The runner validates output shape, finite nonnegative macros, confidence bounds, and membership of returned IDs in the supplied candidate set.
Matcher candidate projections contain only chain, published name, section, serving, region and optional source row tags; target macros, labels, aliases, case IDs, split, category, rationale, and source locators are omitted.
Estimator state contains only chain, item name, section/description/region, and serving; it rejects numeric nutrition-bearing input text.

| Method | Matching | Estimation |
| --- | --- | --- |
| `exact` | Conservative normalized full name, chain, section, region, and explicit serving equality; multiple matches abstain. | Unsupported; displayed as unavailable, never lookup-ground-truth estimates. |
| `jev-v3` | Multi-candidate choice with explicit none/abstain, published-default allowance, and protein/portion/modifier/region constraints; provider argmax, no confidence cutoff. | Existing v3 coarse/fine encoding: exact zero, twelve positive coarse intervals, ten refinements, midpoint decoding, explicit overflow failure. |
| `haiku` | Disabled stub. | Disabled stub. |
| `qwen` | Disabled stub. | Disabled stub. |

The matcher v3 is this suite's multi-candidate extension of the audited published-default experiment; it is not a claim that an earlier production matcher v3 existed.
The estimator reuses v3 question definitions rather than inventing target-dependent bins.
The coarse range stops at 3,000 kcal or 240 g per macro; larger observed overflow is an unsuccessful estimate, with no clipping.
For a new adapter, implement the exported interface in `adapters.ts`, register it in `method` and the CLI allowlist, and test its external boundary before live use.
A future Haiku/Qwen implementation must use its own explicit transport, usage accounting, and authorized budget, maintain the same projections and failure semantics, and never import the historical production pipeline.
No Haiku/Anthropic requests are made by this version.

## Metrics and results

One command prints side-by-side overall and per-category tables for each selected tier/task/method.
Each run saves `run.json`, `predictions.jsonl`, `summary.json`, `report.md`, and, for Jev, raw typed request/response exchanges under `scripts/eval/suite/results/<UTC-run-id>/`.
Metadata pins the executing Git head, protocol, fixture bytes, checksum manifest, complete selection IDs and their digest, population size, and any budget-driven sampling.

Matching pass requires the exact expected ID or explicit NO MATCH.
A wrong-match count includes both false positives on negative cases and a wrong ID on a positive case.
Recall divides correct positive matches by all expected positives, including wrong-ID, abstained, failed, and missing cases in the denominator.
Abstentions include explicit abstention, failed outputs, and omitted cases; abstaining never passes a negative case.

Macro percentage error is absolute error divided by published truth, separately for calories, protein, carbs, and fat.
Against zero truth, exact zero has 0% error and any positive estimate has 100% error.
Per-category macro pass requires every one of the four percentage errors to be at most 25%.
Big miss means strictly greater than 50% calorie error; exactly 50% does not count.
Failed, overflowed, invalid, or unattempted estimates are big misses and contribute infinity to all four full-denominator median errors.
A nonfinite median is serialized as null and displayed as unavailable.
Zero-correctness is the fraction of all zero-valued target macro fields predicted exactly zero, counting failures as incorrect.
Cost per 1,000 uses attempted cases, including both estimator stages and billed failures; unknown usage leaves total cost unavailable while retaining its known subtotal.
An offline-only run reports cumulative provider spend as unavailable instead of falsely resetting it to zero; the cumulative ledger remains untouched.
Latency is end-to-end per attempted item, with nearest-rank p95; both estimator requests contribute.
No successful-only filtering may replace the frozen-denominator primary metrics.

## Jev cost and transport controls

The price is $0.042 per million input tokens and free output, matching the repository's audited pricing and the [official pricing statement](https://typesafe.ai/) rechecked on October 26, 2026.
Actual spend uses returned input-token counts; cost is not estimated from elapsed time.
Every request reserves 16,384 input tokens inside a 12,000-byte request envelope before sending.
The cumulative suite-wide stop threshold is $4.50, inside the user's $5 hard cap.
The default full dev population fits the conservative reservation budget, so it is not sampled.
When a future bulk run would exceed the remaining envelope, the runner retains the whole selected curated tier and deterministically samples bulk by tier/task/chain/category; compared methods share the resulting selection.
The selected IDs, denominator, and sampling flag remain visible.

`results/spend.jsonl` durably records reserve and settle events across invocations, with an exclusive `.jev.lock` preventing overlapping collectors.
Never reset the ledger, split it by method to gain budget, or retry an unknown bill as a free request.
Before sending, the collector indexes prior paid exchanges against their matching run/request settlements, exact model, typed answers and usage.
An identical canonical request, including all candidate fields and tags, replays the recorded answer for zero new charge and writes a source-request reuse receipt.
A changed request needs its own reservation; a previously billed unsuccessful identical request is refused.
Missing paid exchange evidence refuses collection instead of risking a repeated charge.
The replay policy also deduplicates identical inputs across curated and bulk within the same run; reported latency includes replay reads and must not be treated as fresh provider-only latency.
A pending reservation or missing/invalid usage stops future live collection until actual billing is reconciled with human review.
Model drift from `jev-1.14.0`, invalid typed probabilities, HTTP/transport failure, credential echo, token-envelope violation, or spend exhaustion stops the current collector without automatic retry.
Responses are redacted before disk writes if they echo the key; exception messages and headers are never printed or retained.
Requests use a five-second timeout, no redirects, and no retries.
The reservation assumes provider billing stays within its advertised/requested envelope; a provider violation is recorded honestly and stops collection.

## Exclusions and limitations

`data/manifest.json` retains the original 17 held/derived-serving exclusions and the additional 31 Yoshinoya drink-unit exclusions individually.
The audited 22 regular/large/bottled unit defects and nine 14-oz craft drinks with unresolved volume/mass context are all excluded rather than silently converted.
WaBa shrimp, inconsistent dumpling quantities, K-ribs, family salad, Yoshinoya gyoza/kids/one combo/sweet-and-sour facts, and multiplied two-cookie nutrition remain excluded under their prior audit reasons.
The original version left all 2,874 PDF-finder rows outside its 68 individually inspected rows unused.
The measured extension independently checks 118 selected rows, reusing seven original references and admitting 111 additional rows.
Every remaining unchecked PDF-finder row stays unused.
This includes Wahoo's repeated black-bean salsa portions and competing white-rice rows without a reliable serving distinction.
The measured extension explicitly expands source scope to individually checked labelled official Old Spaghetti Factory HTML cards.
It preserves the real HTML section/card locator instead of inventing a PDF page; malformed labels remain excluded.
No third-party nutrition, production database snapshot query, FatSecret value, inferred modifier arithmetic, or model prediction becomes truth.
Source currency, regional recipe availability, correlated menus, manufacturer rounding, and published-table imperfections limit any production-accuracy claim.

## Baseline evidence

Only dev was evaluated.
The [full comparison](../../../scripts/eval/suite/results/2026-10-27T00-11-38-494Z-178b74dc/report.md) ran from committed source `7798fce7154d`, before any result-driven method changes.
All 2,712 selected dev cases were retained without sampling.
The exact adapter supplies matching only; Jev supplies both tasks.

| Dev matching | N | Pass | Wrong match | Recall | Abstain | $/1k | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| curated/matching/exact | 102 | 90.2% | 0 | 80.0% | 0 | 0.0000 | 0.067 |
| curated/matching/jev-v3 | 102 | 92.2% | 4 | 92.0% | 1 | 0.0409 | 155.196 |
| bulk/matching/exact | 2,363 | 97.8% | 0 | 73.9% | 0 | 0.0000 | 0.069 |
| bulk/matching/jev-v3 | 2,363 | 98.3% | 2 | 81.4% | 5 | 0.0296 | 162.364 |

| Dev Jev macro | N | All-four pass | Median % error Cal/P/C/F | Big miss | Zero correct | $/1k | p95 ms |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| curated/macro/jev-v3 | 102 | 11.8% | 20.91/32.12/33.45/31.25 | 21.6% | 86.7% | 0.1262 | 317.2 |
| bulk/macro/jev-v3 | 145 | 7.6% | 19.64/30.00/38.81/35.29 | 20.7% | 87.5% | 0.1268 | 315.6 |

Jev made 2,957 requests for $0.10539795, with no retries, model drift, stop condition, or unknown usage.
The ledger retains every reservation and settlement; the remaining stop-threshold budget is $4.39460205.
The authorized credential file used a legacy `jev` variable; it was mapped to `TYPESAFE_API_KEY` only in the invoking process without printing its value.
The runner now reports that legacy naming mismatch with a safe mapping hint before any request.
Neither Haiku nor Qwen was called.
Reading/checksumming holdout or rendering the human case list did not evaluate holdout.
The two tiers share servings and include correlated candidate pairs, so their scores are not independent population estimates or a production-adoption verdict.

## Case counts by category

| Category | Curated matching | Curated macro | Bulk matching | Bulk macro |
| --- | ---: | ---: | ---: | ---: |
| catering_family | 21 | 15 | 46 | 20 |
| combo_build_your_own | 34 | 20 | 75 | 35 |
| cross_chain_name | 0 | 0 | 1300 | 0 |
| drink_oz | 4 | 8 | 8 | 8 |
| gluten_sensitive | 7 | 0 | 10 | 0 |
| high_calorie | 3 | 9 | 17 | 17 |
| low_calorie | 9 | 17 | 17 | 17 |
| modifier | 13 | 4 | 4 | 4 |
| multiple_pdf_rows | 7 | 0 | 7 | 0 |
| naming_punctuation | 6 | 0 | 11 | 0 |
| near_miss_name | 29 | 32 | 96 | 96 |
| non_chain_lookalike | 16 | 0 | 0 | 0 |
| regional_variant | 3 | 8 | 12 | 12 |
| same_chain_variant | 0 | 0 | 1807 | 0 |
| section_dependent | 12 | 30 | 78 | 78 |
| size_variant | 37 | 29 | 45 | 42 |
| snapshot_missing | 9 | 0 | 38 | 0 |
| snapshot_ue_only | 6 | 0 | 28 | 0 |
| ue_positive | 5 | 0 | 94 | 0 |
| zero_macro | 3 | 6 | 9 | 9 |
