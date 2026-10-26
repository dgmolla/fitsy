**TL;DR:** EXPLORATORY v3 hierarchical scored 167/168 items; frozen v2 remains unchanged.

# Exploratory Jev hierarchical comparison

Mode: live; model(s): jev-1.14.0; stop: completed.
Truth SHA-256: `7fad98db5a79e246a6ae3afc3e4b5953e33c99ee76994701fe010ed35a13c521`; selected IDs SHA-256: `868b0590320ea0769fc1975143251ac43be3ea620349a92a7c0e9bbdd7a1e008`.
Protocol SHA-256: `0f861fd10d25e70393bc3f20955a407171bd86f50c4902f48af57862e3054f7c`.
Reference: `scripts/eval/jev-macro/results/2026-10-26-v2/jev-raw.jsonl.gz`; uncompressed SHA-256: `cfe8dad5d3593513c2b36253be408697b2954dbb919d4e7d81623a988c0bc39b`.

The fixed selection retains 88 WaBa Grill and 80 Yoshinoya rows, excluding 22 unit-defective drinks before collection.
Both v2 decoders and both v3 decoders use these identical serving IDs and truth, in the original order.

## Same 168 rows

| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | 168 | 24.39 | 28.57 | 42.32 | 31.61 | 37/168 (22.02%) | 0.127938 | 214.59 | 266.50 |
| v3 fine conditional EV (secondary) | 168 | 25.02 | 32.24 | 43.25 | 31.91 | 41/168 (24.40%) | 0.127938 | 214.59 | 266.50 |
| saved v2 EV | 168 | 25.86 | 39.45 | 39.18 | 100.00 | 47/168 (27.98%) | 0.482220 | 149.76 | 184.33 |
| saved v2 argmax | 168 | 22.35 | 40.67 | 58.50 | 53.94 | 35/168 (20.83%) | 0.482220 | 149.76 | 184.33 |

## Truth fat >=2 g subset

| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | 121 | 25.00 | 31.58 | 48.75 | 47.62 | 24/121 (19.83%) | 0.132110 | 216.18 | 275.48 |
| v3 fine conditional EV (secondary) | 121 | 24.91 | 34.00 | 44.65 | 36.57 | 23/121 (19.01%) | 0.132110 | 216.18 | 275.48 |
| saved v2 EV | 121 | 23.95 | 29.57 | 40.68 | 88.22 | 24/121 (19.83%) | 0.482214 | 150.85 | 175.71 |
| saved v2 argmax | 121 | 20.71 | 32.26 | 59.00 | 37.04 | 20/121 (16.53%) | 0.482214 | 150.85 | 175.71 |

## Category: desserts

| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | 4 | 10.74 | 16.67 | 23.16 | 11.61 | 0/4 (0.00%) | 0.134967 | 219.02 | 226.36 |
| v3 fine conditional EV (secondary) | 4 | 4.30 | 27.20 | 17.98 | 11.55 | 0/4 (0.00%) | 0.134967 | 219.02 | 226.36 |
| saved v2 EV | 4 | 6.49 | 57.92 | 29.34 | 17.17 | 0/4 (0.00%) | 0.482044 | 148.29 | 168.79 |
| saved v2 argmax | 4 | 20.35 | 33.33 | 27.01 | 20.50 | 0/4 (0.00%) | 0.482044 | 148.29 | 168.79 |

## Category: drinks

| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | 18 | 15.09 | 0.00 | 12.55 | 0.00 | 2/18 (11.11%) | 0.115047 | 211.09 | 279.30 |
| v3 fine conditional EV (secondary) | 18 | 20.39 | 0.00 | 16.12 | 0.00 | 3/18 (16.67%) | 0.115047 | 211.09 | 279.30 |
| saved v2 EV | 18 | 12.29 | 100.00 | 26.36 | 100.00 | 3/18 (16.67%) | 0.482958 | 146.77 | 184.33 |
| saved v2 argmax | 18 | 20.87 | 100.00 | 46.04 | 100.00 | 4/18 (22.22%) | 0.482958 | 146.77 | 184.33 |

## Category: entrees

| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | 56 | 21.22 | 23.96 | 58.00 | 54.55 | 10/56 (17.86%) | 0.133809 | 214.35 | 283.98 |
| v3 fine conditional EV (secondary) | 56 | 24.20 | 31.31 | 50.66 | 48.62 | 9/56 (16.07%) | 0.133809 | 214.35 | 283.98 |
| saved v2 EV | 56 | 17.76 | 28.69 | 35.34 | 134.37 | 8/56 (14.29%) | 0.482238 | 151.12 | 175.89 |
| saved v2 argmax | 56 | 18.31 | 24.07 | 59.00 | 40.00 | 5/56 (8.93%) | 0.482238 | 151.12 | 175.89 |

## Category: family-a-la-carte

| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | 12 | 46.98 | 64.29 | 70.42 | 61.80 | 5/12 (41.67%) | 0.124873 | 213.65 | 266.50 |
| v3 fine conditional EV (secondary) | 12 | 43.03 | 56.24 | 65.42 | 65.25 | 4/12 (33.33%) | 0.124873 | 213.65 | 266.50 |
| saved v2 EV | 12 | 34.05 | 50.20 | 38.31 | 43.58 | 3/12 (25.00%) | 0.481562 | 156.90 | 190.17 |
| saved v2 argmax | 12 | 60.65 | 67.13 | 70.00 | 56.08 | 9/12 (75.00%) | 0.481562 | 156.90 | 190.17 |

## Category: sauces

| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | 20 | 51.19 | 50.00 | 59.82 | 0.00 | 10/20 (50.00%) | 0.115767 | 216.01 | 233.47 |
| v3 fine conditional EV (secondary) | 20 | 56.68 | 70.67 | 44.58 | 0.00 | 10/20 (50.00%) | 0.115767 | 216.01 | 233.47 |
| saved v2 EV | 20 | 138.31 | 100.00 | 86.52 | 100.00 | 15/20 (75.00%) | 0.481870 | 146.12 | 186.37 |
| saved v2 argmax | 20 | 52.44 | 100.00 | 80.36 | 100.00 | 10/20 (50.00%) | 0.481870 | 146.12 | 186.37 |

## Category: sides/components

| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | 58 | 22.77 | 31.41 | 30.00 | 33.92 | 10/58 (17.24%) | 0.130616 | 216.29 | 264.67 |
| v3 fine conditional EV (secondary) | 58 | 26.95 | 31.12 | 40.00 | 25.21 | 15/58 (25.86%) | 0.130616 | 216.29 | 264.67 |
| saved v2 EV | 58 | 28.80 | 28.97 | 53.39 | 81.37 | 18/58 (31.03%) | 0.482243 | 150.49 | 185.23 |
| saved v2 argmax | 58 | 16.64 | 36.67 | 54.77 | 42.17 | 7/58 (12.07%) | 0.482243 | 150.49 | 185.23 |

## Absolute errors and zero-truth behavior

| Run | Cal MAE kcal | Protein MAE g | Carb MAE g | Fat MAE g |
| --- | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | unavailable | unavailable | unavailable | unavailable |
| v3 fine conditional EV (secondary) | unavailable | unavailable | unavailable | unavailable |
| saved v2 EV | 112.84 | 10.19 | 21.57 | 11.01 |
| saved v2 argmax | 129.34 | 10.31 | 30.10 | 6.38 |

| Run | Macro | Zero-truth rows | Exact zero | Positive prediction | Failed item |
| --- | --- | ---: | ---: | ---: | ---: |
| v3 argmax (primary) | calories | 2 | 2 | 0 | 0 |
| v3 argmax (primary) | protein | 26 | 24 | 2 | 0 |
| v3 argmax (primary) | carbs | 7 | 4 | 3 | 0 |
| v3 argmax (primary) | fat | 40 | 34 | 6 | 0 |
| v3 fine conditional EV (secondary) | calories | 2 | 2 | 0 | 0 |
| v3 fine conditional EV (secondary) | protein | 26 | 24 | 2 | 0 |
| v3 fine conditional EV (secondary) | carbs | 7 | 4 | 3 | 0 |
| v3 fine conditional EV (secondary) | fat | 40 | 34 | 6 | 0 |
| saved v2 EV | calories | 2 | 0 | 2 | 0 |
| saved v2 EV | protein | 26 | 0 | 26 | 0 |
| saved v2 EV | carbs | 7 | 0 | 7 | 0 |
| saved v2 EV | fat | 40 | 0 | 40 | 0 |
| saved v2 argmax | calories | 2 | 0 | 2 | 0 |
| saved v2 argmax | protein | 26 | 0 | 26 | 0 |
| saved v2 argmax | carbs | 7 | 0 | 7 | 0 |
| saved v2 argmax | fat | 40 | 0 | 40 | 0 |

## Frozen design and accounting

Primary decoding uses coarse argmax followed by fine argmax midpoint; provider choice breaks ties and confidence has no cutoff.
Coarse zero is exactly zero; overflow fails the item and is never clipped.
The secondary EV normalizes the fine probabilities and is conditional on the chosen coarse interval, with coarse zero still exactly zero.
Each item has at most two POSTs: four 14-choice coarse questions, then one request containing only bounded positive macros with r0..r9 refinements.
Collection requests jev-latest, requires jev-1.14.0 from the first response, reserves 16,384 input tokens per request, caps spend at $1, uses 5-second timeouts and never retries.
Requests attempted: 335/336; known reported spend: $0.02149354; unknown-usage requests: 0.
Cost per 1k includes both stages and divides by attempted items; unknown usage leaves total cost unavailable while retaining the known subtotal.
Item latency is the sum of measured request latencies across both stages; request latency is separately retained in summary.json.
Every failed, invalid, overflow, missing, timed-out or incomplete item is a catastrophic miss and contributes infinity to every full-set MdAPE and MAE.
Non-finite aggregates are serialized as null and shown as unavailable; successful-only MdAPEs are separately retained in summary.json.
Catastrophic means strictly >50% absolute calorie error; zero truth is 0% for exact zero and 100% for a positive prediction.
Repeated serving identities and all six categories are retained in summary.json; rows from two chains are correlated.
This exploratory encoding comparison establishes no Haiku/Qwen ranking or production adoption verdict.
