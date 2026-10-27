**TL;DR:** dev both evaluation completed; 386 selected cases.

| Tier / task / method | N (attempted) | Pass | Wrong match | Recall | Abstain | Median % error Cal/P/C/F | >50% cal | Zero correct | $/1k | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| curated/matching/exact | 49 (49) | 83.7% | 0 | 42.9% | 0 | - | - | - | 0.0000 | 0.1 |
| bulk/matching/exact | 258 (258) | 95.7% | 0 | 89.3% | 0 | - | - | - | 0.0000 | 0.1 |

| Tier / task / category | curated/matching/exact | bulk/matching/exact |
| --- | ---: | ---: |
| catering_family | 100.0% (12/12) | 100.0% (19/19) |
| combo_build_your_own | 100.0% (7/7) | 100.0% (32/32) |
| cross_chain_name | - | 100.0% (69/69) |
| gluten_sensitive | 100.0% (5/5) | 100.0% (8/8) |
| high_calorie | - | 100.0% (7/7) |
| low_calorie | 100.0% (1/1) | 100.0% (2/2) |
| modifier | 100.0% (1/1) | - |
| multiple_pdf_rows | 25.0% (1/4) | 25.0% (1/4) |
| naming_punctuation | 20.0% (1/5) | 12.5% (1/8) |
| near_miss_name | 100.0% (2/2) | 100.0% (27/27) |
| regional_variant | - | 100.0% (1/1) |
| section_dependent | - | 100.0% (30/30) |
| size_variant | 100.0% (3/3) | 100.0% (13/13) |
| snapshot_missing | 100.0% (2/2) | 100.0% (13/13) |
| snapshot_ue_only | 100.0% (5/5) | 100.0% (18/18) |
| ue_positive | 50.0% (1/2) | 85.7% (6/7) |

Matching pass requires exact ID/NO MATCH; abstentions fail.
Macro pass requires every macro error <=25%; exact zero is required against zero truth.
Big miss is strictly >50% calorie error; failures and omissions count as misses and infinite error.
Medians include failures; unavailable medians display as a dash.
Cost/1k divides billed attempts by attempted cases, including both estimator stages.
Repeated UE candidate pairs are correlated; these are case counts, not independent meals.
Replayed identical paid requests: 0; replay incurs no new charge. Latency includes replay reads.
Jev was not selected; cumulative provider spend is not reported by this offline run.
Run known spend: $0.00000000; unknown usage: false.
