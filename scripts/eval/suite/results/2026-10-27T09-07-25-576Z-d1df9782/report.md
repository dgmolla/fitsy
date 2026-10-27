**TL;DR:** dev both evaluation completed; 129 selected cases.

| Tier / task / method | N (attempted) | Pass / all four <=25% | Wrong match | Recall | Abstain | Median % error Cal/P/C/F (all) | >50% cal | Zero correct | Parse/format | Timeout | $/1k | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| curated/matching/exact | 34 (34) | 91.2% | 0 | 81.3% | 0 | - | - | - | 0 | 0 | 0.0000 | 0.1 |
| bulk/matching/exact | 44 (44) | 93.2% | 0 | 90.3% | 0 | - | - | - | 0 | 0 | 0.0000 | 0.1 |
| curated/matching/jev-v3 | 34 (34) | 82.4% | 1 | 81.3% | 5 | - | - | - | 0 | 0 | 0.0000 | 4.0 |
| curated/macro/jev-v3 | 25 (25) | 16.0% | - | - | - | 27.1/28.6/21.7/25.0 | 16.0% | 100.0% | 0 | 0 | 0.0000 | 11.0 |
| bulk/matching/jev-v3 | 44 (44) | 86.4% | 0 | 87.1% | 4 | - | - | - | 0 | 0 | 0.0000 | 4.5 |
| bulk/macro/jev-v3 | 26 (26) | 3.8% | - | - | - | 26.6/50.0/46.8/34.1 | 23.1% | 80.0% | 0 | 0 | 0.0000 | 9.8 |
| curated/matching/haiku | 34 (34) | 73.5% | 6 | 93.8% | 3 | - | - | - | 2 | 0 | 0.0000 | 3.8 |
| curated/macro/haiku | 25 (25) | 4.0% | - | - | - | infinity/infinity/infinity/infinity | 72.0% | 83.3% | 14 | 0 | 0.0000 | 9.0 |
| bulk/matching/haiku | 44 (44) | 95.5% | 1 | 100.0% | 1 | - | - | - | 1 | 0 | 0.0000 | 4.0 |
| bulk/macro/haiku | 26 (26) | 3.8% | - | - | - | infinity/infinity/infinity/infinity | 80.8% | 80.0% | 16 | 0 | 0.0000 | 9.4 |
| curated/matching/qwen | 34 (34) | 88.2% | 3 | 93.8% | 0 | - | - | - | 0 | 0 | 0.0000 | 7.0 |
| curated/macro/qwen | 25 (25) | 0.0% | - | - | - | 91.1/75.9/100.0/50.0 | 56.0% | 83.3% | 8 | 1 | 0.0000 | 8.0 |
| bulk/matching/qwen | 44 (44) | 88.6% | 0 | 83.9% | 3 | - | - | - | 2 | 0 | 0.0000 | 3.7 |
| bulk/macro/qwen | 26 (26) | 7.7% | - | - | - | 66.7/100.0/95.0/75.0 | 57.7% | 80.0% | 7 | 1 | 0.0000 | 10.7 |

| Tier / macro / method (parsed only) | Parsed / all | Median % error Cal/P/C/F | >50% cal | Zero correct | All four <=25% |
| --- | ---: | --- | ---: | ---: | ---: |
| curated/macro/jev-v3 | 25/25 | 27.1/28.6/21.7/25.0 | 16.0% | 100.0% | 16.0% |
| bulk/macro/jev-v3 | 26/26 | 26.6/50.0/46.8/34.1 | 23.1% | 80.0% | 3.8% |
| curated/macro/haiku | 11/25 | 37.5/60.6/30.8/47.6 | 36.4% | 100.0% | 9.1% |
| bulk/macro/haiku | 10/26 | 51.4/36.1/29.2/70.7 | 50.0% | 88.9% | 10.0% |
| curated/macro/qwen | 16/25 | 38.2/19.9/40.9/20.9 | 31.3% | 83.3% | 0.0% |
| bulk/macro/qwen | 18/26 | 41.5/48.1/55.9/48.8 | 38.9% | 80.0% | 11.1% |

| Tier / task / category | curated/matching/exact | bulk/matching/exact | curated/matching/jev-v3 | curated/macro/jev-v3 | bulk/matching/jev-v3 | bulk/macro/jev-v3 | curated/matching/haiku | curated/macro/haiku | bulk/matching/haiku | bulk/macro/haiku | curated/matching/qwen | curated/macro/qwen | bulk/matching/qwen | bulk/macro/qwen |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| catering_family | 100.0% (2/2) | 100.0% (2/2) | 50.0% (1/2) | 0.0% (0/1) | 100.0% (2/2) | 0.0% (0/1) | 50.0% (1/2) | 0.0% (0/1) | 100.0% (2/2) | 0.0% (0/1) | 100.0% (2/2) | 0.0% (0/1) | 100.0% (2/2) | 0.0% (0/1) |
| combo_build_your_own | 100.0% (4/4) | 100.0% (3/3) | 75.0% (3/4) | 0.0% (0/2) | 33.3% (1/3) | 0.0% (0/2) | 75.0% (3/4) | 0.0% (0/2) | 66.7% (2/3) | 0.0% (0/2) | 100.0% (4/4) | 0.0% (0/2) | 100.0% (3/3) | 0.0% (0/2) |
| cross_chain_name | - | 100.0% (2/2) | - | - | 100.0% (2/2) | - | - | - | 100.0% (2/2) | - | - | - | 100.0% (2/2) | - |
| drink_oz | 100.0% (2/2) | 100.0% (2/2) | 100.0% (2/2) | 50.0% (1/2) | 100.0% (2/2) | 50.0% (1/2) | 100.0% (2/2) | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) |
| gluten_sensitive | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) | - | 100.0% (1/1) | - | 100.0% (1/1) | - | 0.0% (0/1) | - | 100.0% (1/1) | - | 100.0% (1/1) | - |
| high_calorie | 100.0% (1/1) | 100.0% (3/3) | 100.0% (1/1) | 0.0% (0/2) | 100.0% (3/3) | 0.0% (0/3) | 100.0% (1/1) | 0.0% (0/2) | 100.0% (3/3) | 0.0% (0/3) | 100.0% (1/1) | 0.0% (0/2) | 100.0% (3/3) | 0.0% (0/3) |
| low_calorie | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 33.3% (1/3) | 100.0% (3/3) | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) | 66.7% (2/3) | 0.0% (0/3) |
| modifier | 100.0% (3/3) | 100.0% (2/2) | 100.0% (3/3) | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) | 0.0% (0/3) | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) | 33.3% (1/3) | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) |
| multiple_pdf_rows | 0.0% (0/1) | 100.0% (1/1) | 0.0% (0/1) | - | 100.0% (1/1) | - | 0.0% (0/1) | - | 100.0% (1/1) | - | 0.0% (0/1) | - | 0.0% (0/1) | - |
| naming_punctuation | 50.0% (1/2) | 50.0% (1/2) | 50.0% (1/2) | - | 50.0% (1/2) | - | 100.0% (2/2) | - | 100.0% (2/2) | - | 100.0% (2/2) | - | 100.0% (2/2) | - |
| near_miss_name | 66.7% (2/3) | 100.0% (4/4) | 100.0% (3/3) | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) | 66.7% (2/3) | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) | 100.0% (3/3) | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| non_chain_lookalike | 100.0% (2/2) | - | 50.0% (1/2) | - | - | - | 0.0% (0/2) | - | - | - | 50.0% (1/2) | - | - | - |
| regional_variant | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 100.0% (1/1) |
| same_chain_variant | - | 100.0% (2/2) | - | - | 100.0% (2/2) | - | - | - | 100.0% (2/2) | - | - | - | 100.0% (2/2) | - |
| section_dependent | 100.0% (1/1) | 100.0% (4/4) | 100.0% (1/1) | 25.0% (1/4) | 100.0% (4/4) | 0.0% (0/4) | 100.0% (1/1) | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) | 100.0% (1/1) | 0.0% (0/4) | 75.0% (3/4) | 0.0% (0/4) |
| size_variant | 100.0% (3/3) | 100.0% (4/4) | 100.0% (3/3) | 0.0% (0/3) | 100.0% (4/4) | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) | 100.0% (4/4) | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) | 100.0% (4/4) | 0.0% (0/3) |
| snapshot_missing | 100.0% (1/1) | 100.0% (2/2) | 100.0% (1/1) | - | 100.0% (2/2) | - | 100.0% (1/1) | - | 100.0% (2/2) | - | 100.0% (1/1) | - | 100.0% (2/2) | - |
| snapshot_ue_only | 100.0% (2/2) | 100.0% (2/2) | 100.0% (2/2) | - | 100.0% (2/2) | - | 100.0% (2/2) | - | 100.0% (2/2) | - | 100.0% (2/2) | - | 100.0% (2/2) | - |
| ue_positive | 100.0% (1/1) | 33.3% (1/3) | 0.0% (0/1) | - | 0.0% (0/3) | - | 100.0% (1/1) | - | 100.0% (3/3) | - | 100.0% (1/1) | - | 33.3% (1/3) | - |
| zero_macro | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 100.0% (1/1) |

Matching pass requires exact ID/NO MATCH; abstentions fail.
Macro pass requires every macro error <=25%; exact zero is required against zero truth.
Big miss is strictly >50% calorie error; failures and omissions count as misses and infinite error.
All-case medians include failures as infinity; parsed-only metrics exclude failed, abstained and missing outputs.
Parse/format failures and timeouts are counted separately from wrong estimates.
Cost/1k divides billed attempts by attempted cases, including both estimator stages.
Repeated UE candidate pairs are correlated; these are case counts, not independent meals.
Replayed identical paid requests: 527; replay incurs no new charge. Latency includes replay reads.
Cumulative known provider spend: $0.57796218.
Run known spend: $0.00000000; unknown usage: false.
