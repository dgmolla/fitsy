# Jev macro accuracy evaluation

**TL;DR:** 190/190 items scored successfully; 0 failures or omissions count as catastrophic misses.

Mode: live; returned model(s): jev-1.14.0.
Stop reason: completed.
Truth SHA-256: `7fad98db5a79e246a6ae3afc3e4b5953e33c99ee76994701fe010ed35a13c521`.
Protocol SHA-256: `77e9a692ce7ca5c93dca5b167f6cd9cafd838d87d41a048a12ecaa2b86e11c76`.

Truth set: WaBa Grill: 88; Yoshinoya: 102.

| Run | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic misses | $ / 1k attempted | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jev | 31.39 | 49.00 | 39.18 | 100.00 | 58/190 | 0.482184 | 148.96 | 185.23 |
| April 2026 haiku-baseline | 12.98 | 15.48 | 14.84 | 21.92 | 8/60 | 0.631240 | 1529.50 | 2080.00 |
| April 2026 haiku-chain-hints | 11.63 | 16.23 | 13.03 | 16.67 | 7/60 | 0.726840 | 1562.00 | 2208.00 |
| April 2026 haiku-serving | 10.99 | 22.08 | 9.45 | 22.22 | 9/60 | 0.773707 | 1608.00 | 2862.00 |

## Scoring and accounting

Catastrophic means strictly greater than 50% absolute calorie error, as defined in `scripts/eval/hero-eval/run.ts:235-237`.
The April zero-truth rule from `scripts/eval/lib/metrics.ts:23-26` is reused directly: zero truth and zero prediction give 0%; zero truth and a positive prediction give 100%.
Every failed, invalid, timed-out, interrupted or unattempted item counts as a catastrophic miss over the full frozen truth denominator.
For full-set MdAPE, failed items contribute positive infinity; an infinite median is serialized as null and shown as unavailable.
The successfulOnlyMedianAbsolutePctError field in summary.json reports the explicitly labeled successful-only statistic.
Latency includes measured failed requests, uses the arithmetic median and nearest-rank p95, and excludes requests with no measured response time.
Known reported spend: $0.09161498; unknown-usage attempts: 0.
A missing or invalid usage record stops the run and leaves total cost and cost per 1k unknown, while retaining the known subtotal.
Cost per 1k uses attempted items, including failures; unattempted items cannot dilute cost.
The frozen price is $0.042 per million input tokens and $0 for output, from docs/engineering/pipeline/jev-chain-match-eval.md (checked there on 2026-10-24).
Live execution has a $1.00 local budget, reserves a bounded request envelope before each attempt, and never retries.

## Choice-bin caveats

Protocol v2 asks four System One choice questions with 101 named bins each: calories in 25-kcal ranges from 0 to 2500 plus 2500+, and protein/carbs/fat in 2-g ranges from 0 to 200 plus 200+.
Estimates are probability-weighted means of bounded-bin midpoints; the open-top representatives are 2525 kcal and 202 g.
Probability sums within 0.01 of one are normalized before averaging; every named probability and a valid confidence are required.
Each result records argmaxBins separately from the mean, with the provider choice breaking equal-probability ties.
Binning adds up to +/-12.5 kcal and +/-1 g (half a bin) of quantization error when the correct bounded bin is identified; distribution uncertainty or wrong bins can add further error.
Open-top bins have no finite quantization-error bound, and their representatives compress all larger quantities into one value.
Even a one-hot first-bin answer yields 12.5 kcal or 1 g, so exact zero is unrepresentable and positive estimates against zero truth incur 100% error under the retained April convention.
The original protocol-v1 HTTP 400 journal is preserved at scripts/eval/jev-macro/results/2026-10-26-attempt1-400.jsonl; it stopped on unknown usage without retry and is incompatible with v2 replay.

## Historical comparison limits

These archived claude-haiku-4-5 runs each used 60 items across six different chains, with different prompts and inputs.
Their older truth was curated from fastfoodnutrition.org and chain websites; it is excluded from the new official-only truth set.
The new set includes sides, sauces, drinks and family servings; rows from the same two chains are correlated.
The April prompt variants were evaluated on their own set; these results do not establish a paired model ranking, causal improvement, or production accuracy.
April costs use historical provider accounting, while Jev uses the frozen Typesafe price; latency comes from different dates and environments.
No historic model code is executed to produce this comparison.

- haiku-baseline: `scripts/eval/results/20260405-000337-haiku-baseline.json`; SHA-256 `d7bacf415779a3b7d8de7bf88cf1e0b8be0705d7872ed73867a2739316288032`; 60/60 scored; 2026-04-05T07:03:37.282Z.
- haiku-chain-hints: `scripts/eval/results/20260405-000551-haiku-chain-hints.json`; SHA-256 `d5fe9a08c9aa84fb888203d9959e963a374d3e9bd29d09ae3ef206981f575c22`; 60/60 scored; 2026-04-05T07:05:51.127Z.
- haiku-serving: `scripts/eval/results/20260405-000601-haiku-serving.json`; SHA-256 `e35d7fda875390921d3d4579e541a00df307ccaaec8527bf642268f9ec4cb865`; 60/60 scored; 2026-04-05T07:06:01.629Z.
