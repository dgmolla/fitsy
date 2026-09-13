# Chain nutrition rollout: production results

**38,511 existing menu rows now use reviewed official nutrition across 48 consumer brands.**
The 39 completed batches cover 54 stored brand identities and exclude the earlier WaBa/Yoshinoya rollout.
National onboarding is still in progress.

## Latest results

| Batch | Production rows | Values changed | Facts / aliases | Preserved IDs | Unselected rows unchanged |
|---|---:|---:|---:|---:|---:|
| Peet's Coffee | 155 | 155 | 20 / 34 | 1,638 | 1,483 |
| Benihana | 56 | 20 | 20 / 32 | 697 | 641 |

Peet's is verified across nine restaurants; Benihana across four.
Both passed a canary covering every approved fact, complete authenticated menu reads, search/detail consistency and zero-change reruns.

| Example row | Previous calories | Reviewed calories |
|---|---:|---:|
| Peet's Cardamom Morning Bun | 485 | 290 |
| Peet's Cheesy Sausage Slider | 325 | 260 |
| Benihana Onion Soup | 203 | 30 |

Peet's uses 13 baked and seven warm-food facts scoped to CA, IL, DC, MD and VA.
The shared regional matcher and both writers shipped through [PR 302](https://github.com/dgmolla/fitsy/pull/302).
Local actual-menu replays found 38 official matches among 455 current UE items and 155 among 1,638 historical items.
All 20 facts remain estimated in WA, CO and unknown-location controls; both April writers reject those ineligible plans.
This is local new-import proof, not a newly added production hex.

Thirteen Peet's facts have one numeric publication, the official regional PDF; seven warm-food facts also agree with the publisher's product pages.
Three published weight differences remain disclosed; the approved whole-item macros agree and are not gram-scaled.
Bacon Sausage Cheddar Crispy, Cinnamon Swirl Crumb Cake and Everything Plant-Based Sandwich remain held for source disagreements.

Benihana's 20 standard items passed root and independent visual source checks, plus a separate check of 236 nonempty source cells.
Its current UE replay produced 40 official matches among 385 items.
Full course meals, samplers, bundles and conflicting values remain held.
Some roll bindings assume the standard named item with corroborating UE calories because the official menu has blank recipe fields.
Published references are not measured portions or ingredient-by-ingredient proof.

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
| Paris Baguette | 224 | 97 | 127 |
| Benihana | 56 | 20 | 36 |
| Peet's Coffee | 155 | 155 | 0 |
| **Total** | **38,511** | **14,794** | **23,717** |

“Values changed” means at least one of calories, protein, carbs or fat changed.
“Attribution only” means those four values stayed the same and reviewed official attribution was applied.
These counts measure rollout behavior, not accuracy against measured food.

The batches loaded **1,668 approved facts and 2,345 exact menu aliases** into the chain catalog.
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
Regional approval support is reviewed at `e805ee2c63ec4e0f19563c6b8ff9fc4a8a3c121d`, merged as `e63f0fc48c9ede443fc60180be43c7c6628b007e` in [PR 302](https://github.com/dgmolla/fitsy/pull/302).
Its exact-merge main Verify, Deploy, production deployment and authenticated serving checks passed.
Offline UE and backfill runs must now use a checkout containing the regional release.
Stop older writers and the chain-unaware rerun command for reviewed menus; narrowing an approval requires a separate data migration first.

## What was proved

| Check | Result and limit |
|---|---|
| Production preservation | All **123,239 menu IDs across 1,235 restaurants** preserved; all **84,728 unselected rows** unchanged |
| Serving | Authenticated reads checked every selected restaurant's complete menu and every changed row; search/detail checks passed per brand |
| Repeated execution | All completed batches produced zero pending catalog and April changes |
| Recovery | Exact local rollback passed; bounded production transactions retain before/after journals; production was not rolled back as a test |
| Future imports | Real parser, resolver, brand handoff, `persistHex` and serving layer exercised locally; no actual production hex added |
| Nutrition reference | Official published facts plus source/binding review; review depth varies by batch and is not measured restaurant nutrition |

Current UE captures and simulated historical imports are separate evidence.
Nine batches after Habit have no current UE capture; their proof does not establish current naming or availability.
Dave's, Charleys, the second Jersey Mike's identity, Panini, Baskin, Cold Stone, NORMS, Kreation, Pressed, Paris Baguette, Benihana and Peet's have additional current-capture replays.
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
| Conflicting source values | Hold disagreements instead of choosing the convenient number; examples include Habit, Charleys, CAVA, Buffalo Wild Wings, Cold Stone and Paris Baguette |
| Wrong source scope | Respect country, region and restaurant eligibility; Peet's is state-scoped; Del Taco remains held for unproven company-owned location eligibility |
| Different portion conventions | Use nutrition servings for whole cakes and bottles; Kreation labels require two servings per bottle |
| Duplicate brand identity | Reuse verified source facts through separate brand-scoped bindings; test each identity without merging unrelated restaurants |
| Existing catalog says “official” | Require a valid review and serving binding; Charleys' 39, Baskin's 10 and Paris Baguette's 249 older unreviewed chain catalog records were preserved and not implicitly promoted |

The approval tool now accepts a completed terminal JSON review verdict while preserving the original reviewer output.
Failed, partial, conditional and malformed verdicts are rejected; root review of findings remains required.

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
5. Keep nutrition accuracy review separate from match coverage and import consistency.

Del Taco remains held because its guide covers company-owned restaurants and location eligibility is unproven.
The inventory's 688 menu-bearing groups are a review cohort, not 688 independently confirmed national chains or approved catalogs.

The [receipt record](chain-production-receipts-2026-09-12.json) contains verification times, counts and approval/readback hashes.
Full source captures, baselines and rollback journals remain in the task archive `work/chain-national`; the aggregate alone cannot perform rollback.
See the [national inventory](chain-national-onboarding.md) and [catalog runbook](chain-catalog-batches.md) for scope and recovery rules.
