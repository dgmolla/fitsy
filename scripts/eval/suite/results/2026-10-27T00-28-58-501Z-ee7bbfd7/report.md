**TL;DR:** dev both evaluation completed; 2712 selected cases.

| Tier / task / method | N (attempted) | Pass | Wrong match | Recall | Abstain | Median % error Cal/P/C/F | >50% cal | Zero correct | $/1k | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| curated/matching/exact | 102 (102) | 90.2% | 0 | 80.0% | 0 | - | - | - | 0.0000 | 0.1 |
| bulk/matching/exact | 2363 (2363) | 97.8% | 0 | 73.9% | 0 | - | - | - | 0.0000 | 0.1 |

| Tier / task / category | curated/matching/exact | bulk/matching/exact |
| --- | ---: | ---: |
| catering_family | 100.0% (4/4) | 100.0% (9/9) |
| combo_build_your_own | 100.0% (17/17) | 100.0% (22/22) |
| cross_chain_name | - | 100.0% (868/868) |
| drink_oz | 100.0% (3/3) | 100.0% (7/7) |
| high_calorie | 50.0% (1/2) | 100.0% (2/2) |
| low_calorie | 66.7% (4/6) | 100.0% (11/11) |
| modifier | 100.0% (7/7) | 100.0% (2/2) |
| near_miss_name | 73.3% (11/15) | 100.0% (30/30) |
| non_chain_lookalike | 100.0% (12/12) | - |
| regional_variant | 100.0% (2/2) | 100.0% (9/9) |
| same_chain_variant | - | 100.0% (1296/1296) |
| section_dependent | 80.0% (8/10) | 100.0% (29/29) |
| size_variant | 95.7% (22/23) | 100.0% (22/22) |
| ue_positive | - | 3.7% (2/54) |
| zero_macro | 100.0% (1/1) | 100.0% (2/2) |

Matching pass requires exact ID/NO MATCH; abstentions fail.
Macro pass requires every macro error <=25%; exact zero is required against zero truth.
Big miss is strictly >50% calorie error; failures and omissions count as misses and infinite error.
Medians include failures; unavailable medians display as a dash.
Cost/1k divides billed attempts by attempted cases, including both estimator stages.
Repeated UE candidate pairs are correlated; these are case counts, not independent meals.
Jev was not selected; cumulative provider spend is not reported by this offline run.
Run known spend: $0.00000000; unknown usage: false.
