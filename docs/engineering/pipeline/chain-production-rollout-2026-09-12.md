# Chain nutrition rollout: production results

**37,787 existing menu rows now use reviewed official nutrition across 44 consumer brands.**
The 35 completed batches cover 50 stored brand identities and exclude the earlier WaBa/Yoshinoya rollout.
National onboarding is still in progress.

## Latest result: Kreation

**82 rows across 19 restaurants are production verified, all with numeric corrections.**
Five reviewed bottle labels support 15 catalog facts and 23 exact aliases under Kreation's three existing brand identities.
All 3,777 menu IDs were preserved; the other 3,695 rows stayed unchanged.

| Drink | Previous calorie range | Published whole bottle |
|---|---:|---:|
| Balance | 13-288 | 520 |
| DStrest | 51-336 | 180 |
| Green 4 | 53-221 | 120 |
| 50 Shades of Green | 47-361 | 120 |
| Electro-Ade | 4-215 | 100 |

Each source label gives two 8 fl oz servings; Fitsy now serves the nutrition for the whole 16 fl oz bottle.
Balance, DStrest and Green 4 explicitly state 16 fl oz in UE.
50 Shades and Electro-Ade use the single published bottle default, an assumption recorded in their source bindings.
The attached Balance label and UE include dates omitted by website prose; 50 Shades UE omits label salt.
These disclosed limitations do not establish exact ingredient weights or sodium values.

Independent review visually read all five original labels, all 20 macro fields, portions and ingredient panels.
All 23 aliases passed local April/import tests, including one current-only Electro-Ade alias.
The six current UE captures matched 27 of 1,255 items; the other 1,228 remained estimated.
Historical simulations covered all 19 complete menus, with 82 official matches and 3,695 estimates.
A joint check against all 749 stored brands verified the three Kreation identities, with 130 serving/recipe/section changes correctly abstaining.

The first identity's 10-row canary exercised every fact before its remaining 53 updates.
The two smaller identities applied all five facts in single nine-row and ten-row transactions.
Final authenticated reads checked every item and updated row across all three identities; repeat catalog and April plans returned zero changes.
Protein Power, Green 2, Green 3, Berryatric, Greentastic and Healixir remain held for unresolved source, recipe or serving evidence.

The preceding Cold Stone and NORMS batches are also production verified: 917 and 133 rows respectively.
Their unresolved serving and source conflicts remain held.
All three chains use the released matcher and writer, so catalog additions required no API deployment.

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
| **Total** | **37,787** | **14,233** | **23,554** |

“Values changed” means at least one of calories, protein, carbs or fat changed.
“Attribution only” means those four values stayed the same and reviewed official attribution was applied.
These counts measure rollout behavior, not accuracy against measured food.

The batches loaded **1,530 approved facts and 2,119 exact menu aliases** into the chain catalog.
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
| Production preservation | All **118,848 menu IDs across 1,204 restaurants** preserved; all **81,061 unselected rows** unchanged |
| Serving | Authenticated reads checked every selected restaurant's complete menu and every changed row; search/detail checks passed per brand |
| Repeated execution | All completed batches produced zero pending catalog and April changes |
| Recovery | Exact local rollback passed; bounded production transactions retain before/after journals; production was not rolled back as a test |
| Future imports | Real parser, resolver, brand handoff, `persistHex` and serving layer exercised locally; no actual production hex added |
| Nutrition reference | Official published facts plus source/binding review; review depth varies by batch and is not measured restaurant nutrition |

Current UE captures and simulated historical imports are separate evidence.
Nine batches after Habit have no current UE capture; their proof does not establish current naming or availability.
Dave's, Charleys, the second Jersey Mike's identity, Panini, Baskin, Cold Stone, NORMS and Kreation have additional current-capture replays.
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
2. Continue through remaining chain identities, prioritizing meals with usable official serving evidence.
3. Package the proven source adapters and proposal checks into repeatable offline onboarding.
4. Release the prepared regional runtime after its required simulator gate, then activate the reviewed Peet's batch.
5. Keep nutrition accuracy review separate from match coverage and import consistency.

Del Taco remains held because its guide covers company-owned restaurants and location eligibility is unproven.
The inventory's 688 menu-bearing groups are a review cohort, not 688 independently confirmed national chains or approved catalogs.

The [receipt record](chain-production-receipts-2026-09-12.json) contains verification times, counts and approval/readback hashes.
Full source captures, baselines and rollback journals remain in the task archive `work/chain-national`; the aggregate alone cannot perform rollback.
See the [national inventory](chain-national-onboarding.md) and [catalog runbook](chain-catalog-batches.md) for scope and recovery rules.
