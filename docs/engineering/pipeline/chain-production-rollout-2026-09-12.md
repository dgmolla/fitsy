# Chain nutrition rollout: production results

**37,705 existing menu rows now use reviewed official nutrition across 43 consumer brands.**
The 32 completed batches cover 47 stored brand identities and exclude the earlier WaBa/Yoshinoya rollout.
National onboarding is still in progress.

## Latest result: NORMS

**133 rows are production verified, all with numeric corrections.**
The 19 reviewed facts and 19 exact aliases cover standalone breakfast sides, fries, potatoes, rice and selected macaroni-and-cheese sides.
All 1,031 menu IDs across seven restaurants were preserved; the other 898 rows stayed unchanged.

| Item | Before | Reviewed published serving |
|---|---:|---:|
| Four bacon strips | 291 calories | 160 calories |
| Side of fries | 373 calories | 170 calories |
| Basket of fries | 589 calories | 341 calories |
| Three turkey sausage patties | 103 calories | 210 calories |

The 19-row canary exercised every fact before the remaining 114 rows were applied.
Final authenticated reads checked all 1,031 items and all 133 updates; repeat catalog and April plans returned zero changes.
All 19 aliases passed local April and import checks, including seven complete historical menu shapes.
Two current UE captures matched 36 of 279 items; the other 243 remained estimated.

Source review checked the publisher's static nutrition table, current menu portion labels and the calculator's default ingredients.
Separate HTML parsers agreed on all 285 selected nutrient cells; independent review checked all 19 macro rows against the original capture.
Published static integers were retained, with calculator fractions corroborating within half a gram.
Calculator observations were manually transferred from actual browser tool output, not raw browser exports.
Eggs and black beans with conflicting calorie values, onion rings missing included ranch, and a questionable 1,523-calorie mac-and-cheese portion remain held.

The preceding Cold Stone batch is also production verified: 917 rows, with 32 numeric changes and 885 attribution confirmations.
All 2,389 IDs and the other 1,472 rows were preserved; all 61 facts and 63 historical aliases passed source and wiring review.
Cold Stone's two current UE captures abstained on all 158 items because selected size was missing; guide/menu conflicts remain held.
Both batches use the released matcher and writer, so catalog additions required no API deployment.

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
| **Total** | **37,705** | **14,151** | **23,554** |

“Values changed” means at least one of calories, protein, carbs or fat changed.
“Attribution only” means those four values stayed the same and reviewed official attribution was applied.
These counts measure rollout behavior, not accuracy against measured food.

The batches loaded **1,515 approved facts and 2,096 exact menu aliases** into the chain catalog.
Jamba, Panera, Popeyes and Jersey Mike's each have two stored identities; their facts remain scoped to the correct identity.
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
| Production preservation | All **115,071 menu IDs across 1,185 restaurants** preserved; all **77,366 unselected rows** unchanged |
| Serving | Authenticated reads checked every selected restaurant's complete menu and every changed row; search/detail checks passed per brand |
| Repeated execution | All completed batches produced zero pending catalog and April changes |
| Recovery | Exact local rollback passed; bounded production transactions retain before/after journals; production was not rolled back as a test |
| Future imports | Real parser, resolver, brand handoff, `persistHex` and serving layer exercised locally; no actual production hex added |
| Nutrition reference | Official published facts plus source/binding review; review depth varies by batch and is not measured restaurant nutrition |

Current UE captures and simulated historical imports are separate evidence.
Nine batches after Habit have no current UE capture; their proof does not establish current naming or availability.
Dave's, Charleys, the second Jersey Mike's identity, Panini, Baskin, Cold Stone and NORMS have additional current-capture replays.
Activating a catalog routes imports through UE but does not guarantee UE returns a menu.
Authenticated checks use the existing allowlisted review account, not a paid-subscription test.

## Repeatable lessons

| Risk | Rule demonstrated by the rollout |
|---|---|
| Same name, different serving | Require the exact item, size and complete order; Wingstop per-wing facts cannot represent an unsized wing order |
| Missing accompaniments | Check included sides and sauces; hold unresolved IHOP omelette sides and Burger King/NORMS onion-ring sauces |
| Calculator controls | Check actions, displayed selections and totals together; Panini has stale checked classes, and Jersey Mike's Markdown lists unselected extras |
| Conflicting source values | Hold disagreements instead of choosing the convenient number; examples include Habit, Charleys, CAVA, Buffalo Wild Wings and Cold Stone |
| Wrong source scope | Respect country, region and restaurant eligibility; Peet's and Del Taco remain inactive for separate scope/release reasons |
| Different portion conventions | Use nutrition servings, not guest counts, for whole Nothing Bundt Cakes products |
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
2. Continue through remaining chain identities, prioritizing meals with usable official serving evidence.
3. Package the proven source adapters and proposal checks into repeatable offline onboarding.
4. Release the prepared regional runtime after its required simulator gate, then activate the reviewed Peet's batch.
5. Keep nutrition accuracy review separate from match coverage and import consistency.

Del Taco remains held because its guide covers company-owned restaurants and location eligibility is unproven.
The inventory's 688 menu-bearing groups are a review cohort, not 688 independently confirmed national chains or approved catalogs.

The [receipt record](chain-production-receipts-2026-09-12.json) contains verification times, counts and approval/readback hashes.
Full source captures, baselines and rollback journals remain in the task archive `work/chain-national`; the aggregate alone cannot perform rollback.
See the [national inventory](chain-national-onboarding.md) and [catalog runbook](chain-catalog-batches.md) for scope and recovery rules.
