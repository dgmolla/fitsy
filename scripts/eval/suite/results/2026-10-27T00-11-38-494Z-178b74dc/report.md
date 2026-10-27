**TL;DR:** dev both evaluation completed; 2712 selected cases.

| Tier / task / method | N (attempted) | Pass | Wrong match | Recall | Abstain | Median % error Cal/P/C/F | >50% cal | Zero correct | $/1k | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| curated/matching/exact | 102 (102) | 90.2% | 0 | 80.0% | 0 | - | - | - | 0.0000 | 0.1 |
| bulk/matching/exact | 2363 (2363) | 97.8% | 0 | 73.9% | 0 | - | - | - | 0.0000 | 0.1 |
| curated/matching/jev-v3 | 102 (102) | 92.2% | 4 | 92.0% | 1 | - | - | - | 0.0409 | 155.2 |
| curated/macro/jev-v3 | 102 (102) | 11.8% | - | - | - | 20.9/32.1/33.5/31.3 | 21.6% | 86.7% | 0.1262 | 317.2 |
| bulk/matching/jev-v3 | 2363 (2363) | 98.3% | 2 | 81.4% | 5 | - | - | - | 0.0296 | 162.4 |
| bulk/macro/jev-v3 | 145 (145) | 7.6% | - | - | - | 19.6/30.0/38.8/35.3 | 20.7% | 87.5% | 0.1268 | 315.6 |

| Tier / task / category | curated/matching/exact | bulk/matching/exact | curated/matching/jev-v3 | curated/macro/jev-v3 | bulk/matching/jev-v3 | bulk/macro/jev-v3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| catering_family | 100.0% (4/4) | 100.0% (9/9) | 100.0% (4/4) | 0.0% (0/7) | 100.0% (9/9) | 0.0% (0/9) |
| combo_build_your_own | 100.0% (17/17) | 100.0% (22/22) | 100.0% (17/17) | 9.1% (1/11) | 100.0% (22/22) | 13.6% (3/22) |
| cross_chain_name | - | 100.0% (868/868) | - | - | 100.0% (868/868) | - |
| drink_oz | 100.0% (3/3) | 100.0% (7/7) | 100.0% (3/3) | 42.9% (3/7) | 100.0% (7/7) | 42.9% (3/7) |
| high_calorie | 50.0% (1/2) | 100.0% (2/2) | 100.0% (2/2) | 50.0% (1/2) | 100.0% (2/2) | 0.0% (0/2) |
| low_calorie | 66.7% (4/6) | 100.0% (11/11) | 100.0% (6/6) | 9.1% (1/11) | 100.0% (11/11) | 0.0% (0/11) |
| modifier | 100.0% (7/7) | 100.0% (2/2) | 100.0% (7/7) | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) |
| near_miss_name | 73.3% (11/15) | 100.0% (30/30) | 80.0% (12/15) | 14.3% (2/14) | 100.0% (30/30) | 13.3% (4/30) |
| non_chain_lookalike | 100.0% (12/12) | - | 75.0% (9/12) | - | - | - |
| regional_variant | 100.0% (2/2) | 100.0% (9/9) | 100.0% (2/2) | 0.0% (0/6) | 100.0% (9/9) | 0.0% (0/9) |
| same_chain_variant | - | 100.0% (1296/1296) | - | - | 99.8% (1294/1296) | - |
| section_dependent | 80.0% (8/10) | 100.0% (29/29) | 90.0% (9/10) | 13.0% (3/23) | 100.0% (29/29) | 0.0% (0/29) |
| size_variant | 95.7% (22/23) | 100.0% (22/22) | 95.7% (22/23) | 0.0% (0/17) | 100.0% (22/22) | 0.0% (0/22) |
| ue_positive | - | 3.7% (2/54) | - | - | 31.5% (17/54) | - |
| zero_macro | 100.0% (1/1) | 100.0% (2/2) | 100.0% (1/1) | 50.0% (1/2) | 100.0% (2/2) | 50.0% (1/2) |

Matching pass requires exact ID/NO MATCH; abstentions fail.
Macro pass requires every macro error <=25%; exact zero is required against zero truth.
Big miss is strictly >50% calorie error; failures and omissions count as misses and infinite error.
Medians include failures; unavailable medians display as a dash.
Cost/1k divides billed attempts by attempted cases, including both estimator stages.
Repeated UE candidate pairs are correlated; these are case counts, not independent meals.
Cumulative known Jev spend: $0.10539795; run known spend: $0.10539795; unknown usage: false.
