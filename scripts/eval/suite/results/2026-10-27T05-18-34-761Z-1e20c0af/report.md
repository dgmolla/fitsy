**TL;DR:** dev both evaluation completed; 3007 selected cases.

| Tier / task / method | N (attempted) | Pass | Wrong match | Recall | Abstain | Median % error Cal/P/C/F | >50% cal | Zero correct | $/1k | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| curated/matching/exact | 143 (143) | 87.4% | 0 | 71.0% | 0 | - | - | - | 0.0000 | 0.1 |
| bulk/matching/exact | 2538 (2538) | 97.5% | 0 | 78.1% | 0 | - | - | - | 0.0000 | 0.0 |
| curated/matching/jev-v3 | 143 (143) | 83.9% | 4 | 82.3% | 16 | - | - | - | 0.0000 | 4.4 |
| curated/macro/jev-v3 | 112 (112) | 10.7% | - | - | - | 24.2/32.1/31.2/31.6 | 20.5% | 86.7% | 0.0000 | 10.4 |
| bulk/matching/jev-v3 | 2538 (2538) | 97.1% | 3 | 82.3% | 37 | - | - | - | 0.0000 | 4.2 |
| bulk/macro/jev-v3 | 214 (214) | 8.9% | - | - | - | 23.3/31.3/38.1/32.3 | 17.8% | 87.5% | 0.0000 | 9.0 |

| Tier / task / category | curated/matching/exact | bulk/matching/exact | curated/matching/jev-v3 | curated/macro/jev-v3 | bulk/matching/jev-v3 | bulk/macro/jev-v3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| catering_family | 100.0% (16/16) | 100.0% (27/27) | 62.5% (10/16) | 0.0% (0/7) | 77.8% (21/27) | 0.0% (0/9) |
| combo_build_your_own | 100.0% (22/22) | 100.0% (52/52) | 90.9% (20/22) | 8.3% (1/12) | 71.2% (37/52) | 13.0% (3/23) |
| cross_chain_name | - | 100.0% (868/868) | - | - | 100.0% (868/868) | - |
| drink_oz | 100.0% (3/3) | 100.0% (7/7) | 100.0% (3/3) | 42.9% (3/7) | 100.0% (7/7) | 42.9% (3/7) |
| gluten_sensitive | 100.0% (5/5) | 100.0% (8/8) | 100.0% (5/5) | - | 100.0% (8/8) | - |
| high_calorie | 50.0% (1/2) | 100.0% (9/9) | 100.0% (2/2) | 25.0% (1/4) | 100.0% (9/9) | 11.1% (1/9) |
| low_calorie | 66.7% (4/6) | 100.0% (12/12) | 100.0% (6/6) | 8.3% (1/12) | 100.0% (12/12) | 8.3% (1/12) |
| modifier | 100.0% (7/7) | 100.0% (2/2) | 100.0% (7/7) | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) |
| multiple_pdf_rows | 25.0% (1/4) | 25.0% (1/4) | 25.0% (1/4) | - | 25.0% (1/4) | - |
| naming_punctuation | 20.0% (1/5) | 12.5% (1/8) | 60.0% (3/5) | - | 50.0% (4/8) | - |
| near_miss_name | 73.3% (11/15) | 100.0% (57/57) | 80.0% (12/15) | 11.8% (2/17) | 100.0% (57/57) | 8.8% (5/57) |
| non_chain_lookalike | 100.0% (12/12) | - | 75.0% (9/12) | - | - | - |
| regional_variant | 100.0% (2/2) | 100.0% (9/9) | 100.0% (2/2) | 0.0% (0/6) | 100.0% (9/9) | 0.0% (0/9) |
| same_chain_variant | - | 100.0% (1296/1296) | - | - | 99.8% (1294/1296) | - |
| section_dependent | 80.0% (8/10) | 100.0% (56/56) | 90.0% (9/10) | 12.0% (3/25) | 100.0% (56/56) | 8.9% (5/56) |
| size_variant | 95.8% (23/24) | 100.0% (29/29) | 95.8% (23/24) | 0.0% (0/18) | 100.0% (29/29) | 0.0% (0/28) |
| snapshot_missing | 100.0% (2/2) | 100.0% (13/13) | 100.0% (2/2) | - | 100.0% (13/13) | - |
| snapshot_ue_only | 100.0% (5/5) | 100.0% (18/18) | 100.0% (5/5) | - | 100.0% (18/18) | - |
| ue_positive | 50.0% (1/2) | 13.1% (8/61) | 0.0% (0/2) | - | 27.9% (17/61) | - |
| zero_macro | 100.0% (1/1) | 100.0% (2/2) | 100.0% (1/1) | 50.0% (1/2) | 100.0% (2/2) | 50.0% (1/2) |

Matching pass requires exact ID/NO MATCH; abstentions fail.
Macro pass requires every macro error <=25%; exact zero is required against zero truth.
Big miss is strictly >50% calorie error; failures and omissions count as misses and infinite error.
Medians include failures; unavailable medians display as a dash.
Cost/1k divides billed attempts by attempted cases, including both estimator stages.
Repeated UE candidate pairs are correlated; these are case counts, not independent meals.
Replayed identical paid requests: 3331; replay incurs no new charge. Latency includes replay reads.
Cumulative known provider spend: $0.12394053.
Run known spend: $0.00000000; unknown usage: false.
