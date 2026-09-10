# WaBa + Yoshinoya: full-source catalog expansion

Status: tested candidate; production rollout pending. This expands the seven-serving pilot using the [reusable batch workflow](chain-catalog-batches.md).

```mermaid
flowchart LR
  P[197 rows in official source tables] --> A[181 accepted published facts]
  P --> H[16 source exceptions held]
  A --> C[182 catalog servings including a two-cookie derivation]
  C --> M[71 servings bound to 97 observed menu variants]
  M --> E[April nutrition-only updates]
  M --> U[Future UE imports use the same matcher]
```

## Candidate results

| Scope | Before | After | Unresolved after |
|---|---:|---:|---:|
| WaBa April menu rows | 46 / 795 | 394 / 795 | 401 |
| Yoshinoya April menu rows | 18 / 542 | 254 / 542 | 288 |
| Total April rows | 64 / 1,337 (4.8%) | 648 / 1,337 (48.5%) | 689 |
| Two captured UE menus | 7 / 151 | 52 / 151 (34.4%) | 99 |

**Main dishes:** 403 of the 648 April matches are bowls, plates or salads (337 WaBa, 66 Yoshinoya). In the current UE captures, only 19 of the 52 matches are main dishes (17 WaBa, 2 Yoshinoya). Most current Yoshinoya matches are sides, drinks or desserts; its generic grilled entrée names allow sauce choices, so those are held. This is not broad current-entrée coverage for Yoshinoya.

The batch adds 175 catalog records; the seven prior approvals remain identical. It should update 584 additional April items across the same 62-location inventory. Facts without aliases remain available for later serving review, without assigning components to meals. Legacy flat catalog records are preserved; unreviewed rows do not participate in the shared matcher.

## What was reviewed

- All 89 rows of WaBa's one-page PDF and all 108 rows of Yoshinoya's two-page PDF, including headings, portion weights, and the standard-recipe footnote. URLs, hashes and page/table locators are stored in the manifest.
- The 237 unique observed variants spanning the April inventory and two complete UE captures. Names, sections, descriptions, counts and available calorie labels remain in the captured fixtures. Each approved variant is reused across locations.
- Seventy-one bound servings have a separate literal macro transcription used by tests. This is an agent review against published nutrition, not an independent human nutrition audit or laboratory measurement.
- Decimal published calories are rounded to the nearest whole kcal for the existing schema. The two-cookie item is exactly twice the published one-cookie values. Other portions are not inferred by scaling.

## Source exceptions held

| Source rows | Count | Reason |
|---|---:|---|
| WaBa shrimp bowl, veggie bowl, plate | 3 | PDF/webpage macro disagreement; UE calorie labels also differ |
| WaBa 5/10/20-piece dumplings | 3 | Inconsistent calorie/macronutrient arithmetic across quantities |
| WaBa K-Ribs plate and strip | 2 | Published trans fat exceeds total fat |
| WaBa family salad | 1 | 300 kcal versus 128 kcal calculated from published macros |
| Yoshinoya regular combo TFC component | 1 | 649 kcal versus 995 kcal calculated from published macros |
| Yoshinoya two kids meals | 2 | Rice-meal heading but only 4/8 g carbohydrate; complete-meal interpretation unresolved |
| Yoshinoya 3/5/10-piece crispy gyoza | 3 | Published saturated fat exceeds total fat |
| Yoshinoya sweet-and-sour sauce | 1 | 13 g sugar exceeds 1 g total carbohydrate |

Additional unmatched menu items include configurable family/combo/taco meals, size ranges, source-missing dishes, and changed salad/sauce-choice descriptions. Regular Gyudon beef disagrees with UE calories; rice component portions do not match UE side labels. No source component is silently used as a full bowl. Published facts can be retained without an approved menu binding.

## Proof and limits

Aliases known to carry a calorie range (including the current featured Chicken Bowl) are not approved even for a later input lacking that label. April rows use their reviewed historical context; their estimated calories are not treated as source evidence.

Local tests replay every observed April variant, preserve unmatched records and non-nutrition fields, and verify served macros against the separate transcription. Both complete UE responses are parsed and sent through the production matcher and hex writer; the external estimator is stubbed only for unresolved items. All 52 matched items persist official values, and all 99 unresolved items take the fallback path.

These captures represent two menus, not a nationwide accuracy estimate. A new location with the same reviewed identity uses the same facts; new wording or conflicting labels abstain. No new production hex or city is imported by this rollout. Refresh remains outside scope.

The larger parallel replay also reproduced serialization failures from raw SQL (Prisma P2010 carrying PostgreSQL SQLSTATE 40001). The same bounded transaction retry now recognizes that known-aborted form; other SQL errors remain non-retryable. Tests force both ORM and raw SQL conflicts.

The checked-in batch is `apps/api/services/chainCatalogs/waba-yoshinoya-2026-09.json`. The generated extraction snapshot accounts for all 197 source rows; acceptance is visible in this document and the batch. Source discovery/extraction remains an offline agent task, while intake, validation, grouped inventory and both serving paths are reusable across chains.
