# Chain nutrition rollout: production results

**38,076 existing menu rows now use reviewed official nutrition across 45 consumer brands.**
The 36 completed batches cover 51 stored brand identities and exclude the earlier WaBa/Yoshinoya rollout.
National onboarding is still in progress.

## Latest result: Pressed

**289 rows across 11 restaurants are production verified, all with numeric corrections.**
The catalog contains 33 new facts and 57 exact aliases; all 1,267 menu IDs were preserved and 978 unselected rows stayed unchanged.

| Example row | Previous calories | Published single bottle |
|---|---:|---:|
| Unwind Tonic | 997 | 90 |
| Carrot Juice | 436 | 120 |
| Blue Pineapple Probiotic Lemonade | 382 | 90 |

These examples show correction magnitude, not accuracy against measured food.
The median absolute calorie change across the 289 rows was 36.
Root and independent review read all 37 original labels and 148 macro fields.
The proposed facts use one complete 450 mL bottle or 59 mL shot, without scaling.
Unsized UE items use the single packaged bottle assumption; April Carrot's missing description is a disclosed weaker binding.

| Evidence | Result |
|---|---|
| Current captured UE imports | 64 official / 162 estimated across 226 items |
| Historical menu simulations | 289 official / 978 estimated across all 11 menus |
| Exact alias coverage | All 57: 54 historical and 3 current-only |
| Identity boundaries | 749 brands, all 11 actual names, 397 negative mutations and 321 held contexts |
| Production | 32-fact canary, full authenticated menu/search checks, preservation and zero-change reruns |

Mango Sunshine is an evidenced rename of Tropical Wellness Smoothie: official and UE text explicitly say the recipe is unchanged.
Old matcha Avocado descriptions and the old Hydration formula remain held.
Chocolate Banana's one April 20 g/coconut-cream context matches, while eight April rows and both current UE captures still say 21 g and remain estimated.
Current Vanilla matches the 30 g label; April's 20 g version conflicts.
Stale official SEO metadata was distinguished from visible product descriptions and attached labels.

Three label-verified products remain held by the released calorie validator: Dark Chocolate, Simple Cleanse and Vanilla.
Their allulose/fiber labels do not fit its naive 4/4/9 check; the rejection and resulting UE estimator fallback were reproduced locally.
No publisher value was changed to pass the check, and no validator was bypassed.

The remaining 978 April rows include 431 packs/programs, 191 third-party packaged products, 154 prepared products, 150 single products needing sources and 52 specific recipe/protein/validator holds.
This is title-based follow-up triage, not proof that all those products have usable official facts.
34 additional official pack pages were retained for separate quantity and serving review.

Kreation's preceding 82 corrections across 19 restaurants remain production verified.
Both chains use the released matcher and writer, so these catalog additions required no API deployment.

## Completed batches

| Completed batch | Rows updated | Values changed | Attribution only |
|---|---:|---:|---:|
| McDonald's, Panda Express, El Pollo Loco | 11,972 | 2,076 | 9,896 |
| Subway, Fatburger, Five Guys, Carl's Jr. | 7,165 | 2,246 | 4,919 |
| Taco Bell | 1,861 | 1,487 | 374 |
| Starbucks | 2,309 | 1,087 | 1,222 |
| Boba Time, Pizza Hut | 2,141 | 1,304 | 837 |
| Jollibee, Goop Kitchen, Rubio's, Farmer Boys | 423 | 246 | 177 |
| Domino's | 1,031 | 1,030 | 1 |
| Jamba, Panera, Robeks | 858 | 546 | 312 |
| Little Caesars, Papa Johns | 1,213 | 397 | 816 |
| Jimmy Johns | 81 | 78 | 3 |
| Wingstop | 382 | 12 | 370 |
| Burger King | 3,033 | 1,673 | 1,360 |
| IHOP | 1,421 | 224 | 1,197 |
| Shake Shack | 446 | 56 | 390 |
| CAVA | 170 | 71 | 99 |
| Habit Burger & Grill | 107 | 107 | 0 |
| Wendy's | 201 | 111 | 90 |
| Fresh Brothers | 18 | 18 | 0 |
| Buffalo Wild Wings | 55 | 25 | 30 |
| Dunkin | 230 | 230 | 0 |
| Jersey Mike's | 60 | 60 | 0 |
| Popeyes | 108 | 108 | 0 |
| California Pizza Kitchen | 380 | 190 | 190 |
| BJ's Restaurant & Brewhouse | 243 | 243 | 0 |
| Nothing Bundt Cakes | 49 | 49 | 0 |
| Dave's Hot Chicken | 28 | 4 | 24 |
| Charleys | 8 | 8 | 0 |
| Jersey Mike's (second identity) | 31 | 7 | 24 |
| Panini Kabob Grill | 150 | 150 | 0 |
| Baskin-Robbins | 481 | 143 | 338 |
| Cold Stone Creamery | 917 | 32 | 885 |
| NORMS | 133 | 133 | 0 |
| Kreation Organic Juicery | 63 | 63 | 0 |
| Kreation Organic | 9 | 9 | 0 |
| Kreation Kafe & Juicery | 10 | 10 | 0 |
| Pressed | 289 | 289 | 0 |
| **Total** | **38,076** | **14,522** | **23,554** |

“Values changed” means at least one of calories, protein, carbs or fat changed.
“Attribution only” means those four values stayed the same and reviewed official attribution was applied.
These counts measure rollout behavior, not accuracy against measured food.

The batches loaded **1,563 approved facts and 2,176 exact menu aliases** into the chain catalog.
Jamba, Panera, Popeyes and Jersey Mike's each have two stored identities; Kreation has three.
Their facts remain scoped to the correct identity.
Dave's and Nothing Bundt Cakes were also linked to 23 existing restaurants without changing their menu identities.

## Both paths use the same catalog

```mermaid
flowchart LR
  S[Official source and serving review] --> C[Approved facts and exact aliases]
  C --> A[Existing April menu update]
  C --> U[UE menu import for a new location]
  A --> P[Stored menu macros and estimates]
  U --> P
  P --> API[Search and restaurant detail]
```

The shared matcher, identity handoff and guarded bulk writer are merged through [PR 289](https://github.com/dgmolla/fitsy/pull/289).
The reviewed writer is `179be20e9a26eda262c428149630f72092730302`, merged as `848f117952b60b62bd1ee03291151e73a1184e55`.
Main Verify, Deploy and authenticated production checks passed for that runtime release.
Offline UE runs must use a checkout containing it.

## What was proved

| Check | Result and limit |
|---|---|
| Production preservation | All **120,115 menu IDs across 1,215 restaurants** preserved; all **82,039 unselected rows** unchanged |
| Serving | Authenticated reads checked every selected restaurant's complete menu and every changed row; search/detail checks passed per brand |
| Repeated execution | All completed batches produced zero pending catalog and April changes |
| Recovery | Exact local rollback passed; bounded production transactions retain before/after journals; production was not rolled back as a test |
| Future imports | Real parser, resolver, brand handoff, `persistHex` and serving layer exercised locally; no actual production hex added |
| Nutrition reference | Official published facts plus source/binding review; review depth varies by batch and is not measured restaurant nutrition |

Current UE captures and simulated historical imports are separate evidence.
Nine batches after Habit have no current UE capture; their proof does not establish current naming or availability.
Dave's, Charleys, the second Jersey Mike's identity, Panini, Baskin, Cold Stone, NORMS, Kreation and Pressed have additional current-capture replays.
Activating a catalog routes imports through UE but does not guarantee UE returns a menu.
Authenticated checks use the existing allowlisted review account, not a paid-subscription test.

## Repeatable lessons

| Risk | Rule demonstrated by the rollout |
|---|---|
| Same name, different serving | Require the exact item, size and complete order; Wingstop per-wing facts cannot represent an unsized wing order |
| Missing accompaniments | Check included sides and sauces; hold unresolved IHOP omelette sides and Burger King/NORMS onion-ring sauces |
| Calculator controls | Check actions, displayed selections and totals together; Panini has stale checked classes, and Jersey Mike's Markdown lists unselected extras |
| Stale page metadata | Compare visible descriptions and attached labels; Pressed SEO retained old formulas while the product panel had changed |
| Energy consistency | Keep a reviewed path for allulose/fiber labels; do not alter source macros to satisfy a naive 4/4/9 equation |
| Conflicting source values | Hold disagreements instead of choosing the convenient number; examples include Habit, Charleys, CAVA, Buffalo Wild Wings and Cold Stone |
| Wrong source scope | Respect country, region and restaurant eligibility; Peet's and Del Taco remain inactive for separate scope/release reasons |
| Different portion conventions | Use nutrition servings for whole cakes and bottles; Kreation labels require two servings per bottle |
| Duplicate brand identity | Reuse verified source facts through separate brand-scoped bindings; test each identity without merging unrelated restaurants |
| Existing catalog says “official” | Require a valid review and serving binding; Charleys' 39 and Baskin's 10 older unreviewed chain catalog records were preserved and not implicitly promoted |

Published default servings remain an explicit assumption where historical menus lack weights or ingredients.
Unresolved cases retain estimates; replay consistency is not evidence that an estimate or published portion is accurate for every order.

## Import gap reproduced

The UE parser currently deduplicates by title alone.
In both captured Panini menus, six distinct family pasta products have different UE IDs and prices but share individual-entree titles, and disappear from the locally served menu.
The writer also deduplicates by name, and the database enforces one name per restaurant, so fixing only the parser would not preserve both products.

The current approved aliases remain safe because their exact sections bind the retained individual entrees and exclude family combos.
The next fix needs source product identity through parsing and persistence while preserving existing Fitsy IDs and saved-item links.
This is a reproduced gap, not a shipped fix; the captured-menu consistency proofs do not establish that every distinct raw UE product survives ingestion.

## Remaining work

1. Fix distinct-product name collisions through the parser, writer and database identity contract, with a staged migration and preserved saved items.
2. Add narrowly reviewed support for legitimate allulose/fiber labels, preserving strict validation for unreviewed facts.
3. Continue through remaining chain identities, prioritizing meals with usable official serving evidence.
4. Package the proven source adapters and proposal checks into repeatable offline onboarding.
5. Release the prepared regional runtime after its required simulator gate, then activate the reviewed Peet's batch.
6. Keep nutrition accuracy review separate from match coverage and import consistency.

Del Taco remains held because its guide covers company-owned restaurants and location eligibility is unproven.
The inventory's 688 menu-bearing groups are a review cohort, not 688 independently confirmed national chains or approved catalogs.

The [receipt record](chain-production-receipts-2026-09-12.json) contains verification times, counts and approval/readback hashes.
Full source captures, baselines and rollback journals remain in the task archive `work/chain-national`; the aggregate alone cannot perform rollback.
See the [national inventory](chain-national-onboarding.md) and [catalog runbook](chain-catalog-batches.md) for scope and recovery rules.
