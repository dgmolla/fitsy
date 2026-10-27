**TL;DR:** Strict scoring retains 129 DEV cases; Haiku repair spends $0.09362800; cumulative ledger is $0.67159018.

# Haiku and Qwen DEV sample comparison

Generated from the committed-source run, original preflight, predictions, raw exchanges and additive spend ledger.
The sample contains 34 curated matching, 25 curated macro, 44 bulk matching and 26 bulk macro cases.
The original `modelSelection` chose these IDs before any paid output, with a $2.69768053 reservation under the $2.70 stop and $3 hard cap.
The ordered selection SHA-256 is `3ec69529643a0253f95c4e04f927fe0d157c2d9fef14891af309962015a4fa70`.
Source head: `0e7333ab48a94171f9090afdc343444442f0e7e9`; final run: `2026-10-27T09-17-50-049Z-7691bbd3`.
Every matching method completed the same 78 matching cases, and every supported estimator completed the same 51 macro cases.
Exact has no macro estimator, so its macro measurements are explicitly unavailable.
No holdout evaluation or database connection is part of this comparison.

```mermaid
flowchart LR
  A[Frozen 129 DEV cases] --> B[Exact matching]
  A --> C[Jev cached responses]
  A --> D[Haiku responses]
  A --> E[Qwen responses]
  B --> F[Fixed scoring and bill audit]
  C --> F
  D --> F
  E --> F
```

## Matching

| Tier | Method | Pass | Wrong matches | Recall | Abstain |
| --- | --- | ---: | ---: | ---: | ---: |
| curated | exact | 31/34 (91.2%) | 0/34 (0.0%) | 13/16 (81.3%) | 0/34 (0.0%) |
| curated | jev-v3 | 28/34 (82.4%) | 1/34 (2.9%) | 13/16 (81.3%) | 5/34 (14.7%) |
| curated | haiku | 25/34 (73.5%) | 6/34 (17.6%) | 15/16 (93.8%) | 3/34 (8.8%) |
| curated | qwen | 30/34 (88.2%) | 3/34 (8.8%) | 15/16 (93.8%) | 0/34 (0.0%) |
| bulk | exact | 41/44 (93.2%) | 0/44 (0.0%) | 28/31 (90.3%) | 0/44 (0.0%) |
| bulk | jev-v3 | 38/44 (86.4%) | 0/44 (0.0%) | 27/31 (87.1%) | 4/44 (9.1%) |
| bulk | haiku | 42/44 (95.5%) | 1/44 (2.3%) | 31/31 (100.0%) | 1/44 (2.3%) |
| bulk | qwen | 39/44 (88.6%) | 0/44 (0.0%) | 26/31 (83.9%) | 3/44 (6.8%) |

Pass requires the exact expected ID or explicit NO MATCH.
Wrong counts returned IDs that differ from the expected match; missed positives reduce recall.
Abstentions and invalid outputs fail the pass metric.

## Macro estimation

| Tier | Method | View | N | Median error % Cal/P/C/F | >50% calorie error | Zero correct | All four within 25% | Parse/format | Timeout | Abstain |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| curated | exact | N/A | 25 selected | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| curated | jev-v3 | all cases | 25 | 27.1/28.6/21.7/25.0 | 4/25 (16.0%) | 12/12 (100.0%) | 4/25 (16.0%) | 0 | 0 | 0 |
| curated | jev-v3 | parsed only | 25 | 27.1/28.6/21.7/25.0 | 4/25 (16.0%) | 12/12 (100.0%) | 4/25 (16.0%) | 0 | 0 | 0 |
| curated | haiku | all cases | 25 | 30.2/46.2/33.8/80.0 | 10/25 (40.0%) | 12/12 (100.0%) | 2/25 (8.0%) | 0 | 0 | 0 |
| curated | haiku | parsed only | 25 | 30.2/46.2/33.8/80.0 | 10/25 (40.0%) | 12/12 (100.0%) | 2/25 (8.0%) | 0 | 0 | 0 |
| curated | qwen | all cases | 25 | 91.1/75.9/100.0/50.0 | 14/25 (56.0%) | 10/12 (83.3%) | 0/25 (0.0%) | 8 | 1 | 0 |
| curated | qwen | parsed only | 16 | 38.2/19.9/40.9/20.9 | 5/16 (31.3%) | 10/12 (83.3%) | 0/16 (0.0%) | 8 | 1 | 0 |
| bulk | exact | N/A | 26 selected | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| bulk | jev-v3 | all cases | 26 | 26.6/50.0/46.8/34.1 | 6/26 (23.1%) | 8/10 (80.0%) | 1/26 (3.8%) | 0 | 0 | 0 |
| bulk | jev-v3 | parsed only | 26 | 26.6/50.0/46.8/34.1 | 6/26 (23.1%) | 8/10 (80.0%) | 1/26 (3.8%) | 0 | 0 | 0 |
| bulk | haiku | all cases | 26 | 36.0/44.5/37.1/64.4 | 11/26 (42.3%) | 9/10 (90.0%) | 1/26 (3.8%) | 0 | 0 | 0 |
| bulk | haiku | parsed only | 26 | 36.0/44.5/37.1/64.4 | 11/26 (42.3%) | 9/10 (90.0%) | 1/26 (3.8%) | 0 | 0 | 0 |
| bulk | qwen | all cases | 26 | 66.7/100.0/95.0/75.0 | 15/26 (57.7%) | 8/10 (80.0%) | 2/26 (7.7%) | 7 | 1 | 0 |
| bulk | qwen | parsed only | 18 | 41.5/48.1/55.9/48.8 | 7/18 (38.9%) | 8/10 (80.0%) | 2/18 (11.1%) | 7 | 1 | 0 |

Percent error uses absolute error divided by truth, with exact zero required for zero truth.
Against zero truth, zero prediction has 0% error and any nonzero prediction has 100% error under the frozen metric.
Zero correctness counts individual zero-valued macro fields, rather than whole meals.
The calorie miss threshold is strictly greater than 50%, and all-four success requires each error to be at most 25%.
The all-case view counts every missing estimate as infinite error and a calorie miss; its medians include these failures.
The parsed-only view includes only valid complete macro predictions and uses its own case and zero-field denominators.
Parse failures count malformed JSON and invalid typed fields/probability distributions; timeouts and estimator abstentions are separate.
Haiku format recovery uses a changed probability instruction only on original failed cases; this primary view still uses the unchanged strict decoder.

## Cost and latency

| Tier | Method | Attempted cases | New USD/1k cases | Recorded request USD/1k | Execution p95 ms | Original request-total p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| curated | exact | 34 | 0.0000 | 0.0000 | 0.1 | N/A |
| curated | jev-v3 | 59 | 0.0000 | 0.0745 | 8.8 | 299.6 |
| curated | haiku | 59 | 4.6914 | 3.8669 | 11.2 | 8723.0 |
| curated | qwen | 59 | 0.3662 | 0.3662 | 8.8 | 60777.4 |
| bulk | exact | 44 | 0.0000 | 0.0000 | 0.1 | N/A |
| bulk | jev-v3 | 70 | 0.0000 | 0.0730 | 9.8 | 264.5 |
| bulk | haiku | 70 | 3.3201 | 3.6357 | 8.2 | 8723.0 |
| bulk | qwen | 70 | 0.2406 | 0.3261 | 7.7 | 152666.0 |
| both | exact | 78 | 0.0000 | 0.0000 | 0.1 | N/A |
| both | jev-v3 | 129 | 0.0000 | 0.0737 | 9.2 | 278.7 |
| both | haiku | 129 | 3.9473 | 3.7414 | 10.2 | 8723.0 |
| both | qwen | 129 | 0.2981 | 0.3445 | 8.3 | 92788.0 |

New USD/1k includes all actual bills from the initial and continuation runs, including failed answers, divided by the selected supported cases.
Recorded request USD/1k sums original response usage costs for the requests consumed by those same cases, including both estimator stages and replayed inputs.
It is a request-equivalent reference cost, rather than another charge or a new call to a provider.
Execution p95 measures the final runner and includes replay reads.
Original request-total p95 sums retained original request durations within each case, including both stages where called; it excludes current replay savings and some runner overhead.
Every provider is replayed in this re-score, so execution p95 measures local replay rather than live provider latency.
Retained original request timings were collected at different times and are descriptive measurements, not a controlled current latency benchmark.
Exact timing covers matching only; no exact macro cost or latency is implied.

## Spend and evidence

Actual new inference spend: **$0.54764965**, comprising Haiku **$0.50920000** and Qwen **$0.03844965**.
Exact and Jev add $0.
Historical Jev spend remains $0.12394053; cumulative suite spend is $0.67159018.
The audit reconciles 342 distinct paid model inputs, zero repeated paid inputs, zero new Jev requests, no pending reservations and no unknown usage.
The complete original ledger prefix is preserved.
The two HTTP 400 rejections are retained with their original unknown settlements and additive zero-inference reconciliation receipts.
One Qwen body timed out at 60 seconds; its output remains failed and its $0.00070390 charge is allocated from the sole unresolved request in stable same-key usage counters, within the original reservation.
The before/after lifetime delta matches the daily total, and the two post-timeout reads were unchanged for 289.436 seconds.
This allocation uses aggregate billing evidence; that response has no recovered token-level usage or output.
A second Qwen body timed out at 180 seconds; its retained header generation ID identifies an exact $0.00080546 cancelled-generation bill with 1,054 prompt and 1,292 completion tokens.
Both missing outputs remain failed, and the observed timeout durations are censored latency measurements.
Later unseen Qwen inputs use a 300-second deadline at the same token/price ceiling and preserve generation IDs before body reads.
The final re-score makes no inference calls; each consumed request identifies its original billed response.
Cached Haiku failures have completed valid JSON with invalid probability distributions, rather than recoverable JSON syntax.
The shared strict decoder rejects totals outside its original tolerance or a choice inconsistent with argmax; normalization would change the comparison.
The later pre-existing continuation already attempted all 129 Qwen cases, including the previously pending nine bulk cases.
Anthropic rejected the original macro grammar during schema compilation; shared internal definitions preserve the exact expanded schema and required output constraints.
OpenRouter initially selected a GMICloud endpoint that rejected the model as deprecated; a same-key, same-day zero-usage read independently confirms that rejection added no charge.
Qwen then uses the same model on `deepinfra/fp8`, with fallbacks disabled and the original price ceiling.
This provider and quantization are comparison limitations, as are the providers' constrained-generation transport differences from Jev.
The questions, state projections, bins, targets and final decoder remain unchanged.
Haiku adds a system instruction requiring probability totals of one and choice equal to argmax.
Successful original answers remain cached; only the 30 original failed macro cases and three matching failures are eligible for the changed request.
This targeted DEV recovery mixes original and repaired Haiku responses and does not represent a fresh independent benchmark of the new prompt.
The sample is small and deterministic, spans correlated candidate pairs, and supports DEV comparison rather than holdout generalization or production adoption.

Evidence: [canonical summary](summary.json), [predictions](predictions.jsonl), [bill and sample audit](comparison-audit.json), [source and selection](run.json).
Provider contracts: [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenRouter routing](https://openrouter.ai/docs/guides/routing/provider-selection), [current-key usage](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key).

## Combined strict comparison

| Method | Matching pass | Wrong matches | Recall | Macro parsed/all | Median % Cal/P/C/F parsed | Median % Cal/P/C/F all | >50% cal parsed/all | All four <=25% parsed/all |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| exact | 72/78 (92.3%) | 0 | 41/47 (87.2%) | N/A | N/A | N/A | N/A | N/A |
| jev-v3 | 66/78 (84.6%) | 1 | 40/47 (85.1%) | 51/51 | 27.1/35.2/28.6/31.3 | 27.1/35.2/28.6/31.3 | 10/51; 10/51 | 5/51; 5/51 |
| haiku | 67/78 (85.9%) | 7 | 46/47 (97.9%) | 51/51 | 34.5/45.9/36.7/80.0 | 34.5/45.9/36.7/80.0 | 21/51; 21/51 | 3/51; 3/51 |
| qwen | 69/78 (88.5%) | 3 | 41/47 (87.2%) | 34/51 | 40.8/29.0/48.3/36.3 | 75.0/100.0/100.0/68.8 | 12/34; 29/51 | 2/34; 2/51 |

## Failure attribution before and after

Wrong estimate means a parsed macro prediction with at least one error above 25%; output failures are counted separately.

| Method / task | Before parse/format/timeout | After parse/format/timeout | Before wrong estimates | After wrong estimates |
| --- | --- | --- | ---: | ---: |
| exact/matching | 0/0/0 | 0/0/0 | N/A | N/A |
| jev-v3/matching | 0/0/0 | 0/0/0 | N/A | N/A |
| jev-v3/macro | 0/0/0 | 0/0/0 | 46 | 46 |
| haiku/matching | 0/3/0 | 0/1/0 | N/A | N/A |
| haiku/macro | 0/30/0 | 0/0/0 | 19 | 48 |
| qwen/matching | 0/2/0 | 0/2/0 | N/A | N/A |
| qwen/macro | 0/15/2 | 0/15/2 | 32 | 32 |

## SECONDARY: normalized original cache only

This diagnostic renormalizes original Haiku vectors and selects their exact maximum, using no repaired responses or live calls.
It changes the answer contract and is excluded from the strict comparison above.
2 cases require an absent refinement after coarse argmax changes; they remain cache failures, without invented estimates.

| Method / view | Matching pass | Wrong matches | Recall | Macro parsed/all | Median % Cal/P/C/F parsed | Median % Cal/P/C/F all | >50% cal parsed/all | All four <=25% parsed/all |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| Haiku normalized original cache | 68/78 (87.2%) | 8 | 46/47 (97.9%) | 49/51 | 37.5/48.9/30.8/81.3 | 41.7/50.0/33.8/85.0 | 21/49; 23/51 | 3/49; 3/51 |

This repair adds 30 distinct changed-payload requests for $0.09362800.
The ledger totals $0.67159018, including all historical Jev, Haiku and Qwen bills.
