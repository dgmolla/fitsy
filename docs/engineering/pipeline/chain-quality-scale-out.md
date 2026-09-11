# Chain match quality and scale-out

The candidate batch adds 66 official matches across the existing WaBa and Yoshinoya April menus.
This is agent-reviewed source and serving evidence, not a measured human-reviewed nutrition accuracy score.
Production rollout evidence is recorded separately after shipping.

| Measure | Before | Candidate after | Meaning |
|---|---:|---:|---|
| April official rows | 592 / 1,337 | 658 / 1,337 | +59 exact packaged drinks and +7 Chicken Bowls |
| April estimated rows | 745 | 679 | Unresolved cases stay estimated |
| Captured UE official rows | 52 / 151 | 62 / 151 | WaBa 20 to 29; Yoshinoya 32 to 33 |
| New manufacturer facts | 0 in this batch | 9 | Reusable across chains through explicit bindings |
| Existing approvals reversed | 0 | 0 | No confirmed contradiction found for the applied contexts |

The batch also updates the approval reference on 18 already-official historical Chicken Bowls without changing their nutrients.
The expected production write set is therefore 84 rows: 66 new matches plus 18 attribution updates.
Current-menu replay proves the importer behavior using captured menus and an isolated database; it does not create production locations.

The production snapshot shows numeric corrections on 61 of the 66 newly matched rows; five already have the correct numbers and gain official attribution.
Ten corrections change calories by at least 100 kcal.
Identical branded products currently receive different estimates across locations, so these are consistency and accuracy improvements as well as coverage gains.

| Item | Current estimated calories across locations | Published candidate | Rows |
|---|---:|---:|---:|
| Chicken Bowl | 514-588 | 640, with 38 g protein / 100 g carbs / 11 g fat | 7 |
| Pepsi 20 oz | 147-281 | 250 | 7 |
| Dole Apple Juice 15.2 oz | 65-156 | 210 | 6 |
| Unsweet Pure Leaf 16.9 oz | 0-91 | 0 | 7 |

## What the audit found

| Finding | Concrete example | Decision |
|---|---|---|
| Exact manufacturer labels close source gaps | Pepsi 20 oz: 250 kcal; Gatorade 20 oz: 140 kcal | Add nine fully identified products; keep flavor and package size distinct |
| A range sometimes has a documented default | WaBa Chicken Bowl: white rice, regular chicken, WaBa sauce | Approve 640 kcal for the two reviewed menu contexts and exact 640-760 range |
| Required choices sometimes have no default | WaBa tacos, family rice, family protein selector | Keep estimated until a specific complete configuration is established |
| PDF and HTML have different coverage | Yoshinoya HTML adds 99 g cheesecake and 227 g rice rows | Add candidates to research, not automatic bindings to generic cheesecake or rice |
| Official pages can disagree or contain errors | Yoshinoya HTML beef differs materially from PDF; PDF gyoza has saturated fat above total fat | Keep affected facts or bindings held; do not prefer a whole source blindly |
| Recipe wording protects identity | April Signature House includes chicken; current official ordering requires a protein choice | Keep the existing description-sensitive binding; do not inherit it by name |
| Discovery source is not menu source | Sparse historical menus were built by the FatSecret menu adapter at UE-discovered restaurants | Do not use `Restaurant.source = ue_feed` as evidence that the menu came from UE |

The 592 prior applied rows retain their evidence distinctions: 281 have matching-context captured UE calorie corroboration, 113 have reviewed mappings without that corroboration, and 198 have sparse historical WaBa names.
Calorie corroboration checks calories, not all three macros or actual kitchen portions.
The 198 rows represent only 11 repeated aliases, not 198 independent quality observations.
Their historical physical serving sizes remain unverified; no new aliases were inferred from them.
The two sparse protein-side aliases account for 36 rows and deserve explicit serving confirmation in the next human review.

## Remaining 679 rows

| Evidence band | Rows | Next evidence needed |
|---|---:|---|
| Nearby identity | 154 | Resolve generic chicken, half-half, cheesecake, vegetables and salad recipe identity |
| Serving or option ambiguity | 134 | Identify the actual default, package size or selected configuration |
| Only components available | 115 | Establish all ingredients, quantities and included sides before summing |
| Source disagreement | 109 | Resolve the specific serving/version conflict; keep inconsistent facts quarantined |
| No applicable fact in the reviewed source set | 167 | Expand official source discovery; absence in a PDF is not proof no official fact exists |

The last band includes 13 exact packaged rows still held: Dole Lemonade 20 oz and Orange Crush 20 oz.
The official distributor pages identify these packages but did not expose complete nutrition labels in this pass.
The other 154 source-gap rows need recipe-specific evidence, including Yoshinoya Miso Soup and Strawberry Shortcake.

## Repeatable operating flow

The 1,337 April rows reduce to 168 distinct menu contexts.
The 66 new matches come from ten reviewed contexts, which is the useful unit of onboarding work.
Sample locations separately to detect exceptions; repeated rows are coverage, not independent accuracy evidence.

```mermaid
flowchart LR
  A[Unique menu contexts and counts] --> B[Candidate official facts]
  P[Chain PDF plus HTML] --> B
  M[Manufacturer facts once per product] --> B
  B --> C[Recipe, serving and source checks]
  C --> D[Approved catalog batch]
  C --> H[Held cases with a reason]
  D --> E[Same matcher]
  E --> F[April nutrition-only update]
  E --> G[New UE import]
```

1. **Prioritize repeated menu variants and main dishes.** Count affected locations and rows, but review each distinct recipe/serving context once.
2. **Capture complete source context.** Keep PDF table headings, HTML-only rows, source URLs/hashes and manufacturer label images; compare conflicts per fact.
3. **Reuse packaged facts across chains.** Key by market, brand, flavor and package serving, then approve each chain's exact menu binding.
4. **Treat closeness as a review queue.** Similar names propose candidates; they do not authorize writes.
5. **Require evidence for defaults.** Inspect every required food choice, optional defaults and quantity; a placeholder such as “Select Your Sauce” is not a selection.
6. **Test accepted and rejected contexts together.** Replay full menus, check April updates, preserve IDs and unrelated fields, and prove rollback before the canary.
7. **Measure quality separately from coverage.** Have a human label correct recipe, correct serving and correct transcription independently, stratified across applied evidence bands and near misses.

The same approved facts feed both writers, with no extra model, network or per-item database calls in matching.
The manufacturer compiler is offline and deterministic; it does not discover sources or automatically approve fuzzy bindings.
National onboarding can proceed chain by chain, reusing manufacturer facts and contextual aliases across stores.
After this matcher/schema release, compatible facts and aliases can ship as guarded data batches without an API deployment or a separate implementation per chain.
New serving or matching behavior still requires a code release and regression coverage.
Track approved distinct contexts, affected rows, meal versus drink coverage, held reasons, and human-reviewed recipe/serving/transcription precision separately.
For the next review, prioritize the 36 already-applied sparse protein-side rows, then repeated unresolved main dishes; more drink matches alone do not establish better meal recommendations.
Menu-source provenance is a remaining improvement: record discovery source, menu source and nutrition source separately when importing future menus.
Refresh scheduling and additional menu providers remain outside scope.

## Reproduce the batch

The reviewed input is `apps/api/services/chainCatalogs/chain-quality-2026-09-input.json`.
It contains source URLs, content hashes, label locators and the exact default selections.

```sh
npx tsx scripts/preload-chain-product-batch.ts apps/api/services/chainCatalogs/chain-quality-2026-09-input.json work/chain-quality-batch.json
# Then follow the guarded catalog-plan/apply and april-plan/apply procedure:
# docs/engineering/pipeline/chain-catalog-batches.md
```

Use a new output path; the compiler refuses to overwrite an existing artifact.
Deploy the matcher code before applying this catalog: older code rejects the new default-serving approval fields.
For a code rollback, first roll back the April writes and then the catalog, using their saved journals, before restoring the older code.
The regression fixture independently transcribes all nine product labels and the Chicken Bowl facts.
The database replay covers all April variants, both complete captured UE menus, search/detail consistency, catalog identity, unrelated-row preservation and rollback.
Tests do not establish that customers receive exactly the published portion or choose the documented default.
