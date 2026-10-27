**TL;DR:** dev both evaluation completed; 386 selected cases.

| Tier / task / method | N (attempted) | Pass | Wrong match | Recall | Abstain | Median % error Cal/P/C/F | >50% cal | Zero correct | $/1k | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| curated/matching/exact | 49 (49) | 83.7% | 0 | 42.9% | 0 | - | - | - | 0.0000 | 0.2 |
| bulk/matching/exact | 258 (258) | 95.7% | 0 | 89.3% | 0 | - | - | - | 0.0000 | 0.2 |
| curated/matching/jev-v3 | 49 (49) | 69.4% | 0 | 50.0% | 15 | - | - | - | 0.0344 | 157.8 |
| curated/macro/jev-v3 | 10 (10) | 0.0% | - | - | - | 35.4/23.6/27.0/35.4 | 10.0% | - | 0.1324 | 334.5 |
| bulk/matching/jev-v3 | 258 (258) | 86.4% | 1 | 86.4% | 32 | - | - | - | 0.0297 | 185.4 |
| bulk/macro/jev-v3 | 69 (69) | 4.3% | - | - | - | 24.6/31.9/40.0/28.6 | 13.0% | - | 0.1140 | 315.3 |

| Tier / task / category | curated/matching/exact | bulk/matching/exact | curated/matching/jev-v3 | curated/macro/jev-v3 | bulk/matching/jev-v3 | bulk/macro/jev-v3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| catering_family | 100.0% (12/12) | 100.0% (19/19) | 50.0% (6/12) | - | 68.4% (13/19) | - |
| combo_build_your_own | 100.0% (7/7) | 100.0% (32/32) | 71.4% (5/7) | 0.0% (0/1) | 53.1% (17/32) | 0.0% (0/1) |
| cross_chain_name | - | 100.0% (69/69) | - | - | 100.0% (69/69) | - |
| gluten_sensitive | 100.0% (5/5) | 100.0% (8/8) | 100.0% (5/5) | - | 100.0% (8/8) | - |
| high_calorie | - | 100.0% (7/7) | - | 0.0% (0/2) | 100.0% (7/7) | 0.0% (0/7) |
| low_calorie | 100.0% (1/1) | 100.0% (2/2) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (2/2) | 0.0% (0/1) |
| modifier | 100.0% (1/1) | - | 100.0% (1/1) | - | - | - |
| multiple_pdf_rows | 25.0% (1/4) | 25.0% (1/4) | 25.0% (1/4) | - | 25.0% (1/4) | - |
| naming_punctuation | 20.0% (1/5) | 12.5% (1/8) | 60.0% (3/5) | - | 50.0% (4/8) | - |
| near_miss_name | 100.0% (2/2) | 100.0% (27/27) | 100.0% (2/2) | 0.0% (0/3) | 100.0% (27/27) | 3.7% (1/27) |
| regional_variant | - | 100.0% (1/1) | - | - | 100.0% (1/1) | - |
| section_dependent | - | 100.0% (30/30) | - | 0.0% (0/2) | 100.0% (30/30) | 7.4% (2/27) |
| size_variant | 100.0% (3/3) | 100.0% (13/13) | 100.0% (3/3) | 0.0% (0/1) | 100.0% (13/13) | 0.0% (0/6) |
| snapshot_missing | 100.0% (2/2) | 100.0% (13/13) | 100.0% (2/2) | - | 100.0% (13/13) | - |
| snapshot_ue_only | 100.0% (5/5) | 100.0% (18/18) | 100.0% (5/5) | - | 100.0% (18/18) | - |
| ue_positive | 50.0% (1/2) | 85.7% (6/7) | 0.0% (0/2) | - | 0.0% (0/7) | - |

Matching pass requires exact ID/NO MATCH; abstentions fail.
Macro pass requires every macro error <=25%; exact zero is required against zero truth.
Big miss is strictly >50% calorie error; failures and omissions count as misses and infinite error.
Medians include failures; unavailable medians display as a dash.
Cost/1k divides billed attempts by attempted cases, including both estimator stages.
Repeated UE candidate pairs are correlated; these are case counts, not independent meals.
Replayed identical paid requests: 61; replay incurs no new charge. Latency includes replay reads.
Cumulative known Jev spend: $0.12394053.
Run known spend: $0.01854258; unknown usage: false.
