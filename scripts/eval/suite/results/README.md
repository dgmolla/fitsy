**TL;DR:** The full exact/Jev dev comparison completed for $0.10539795; holdout remains unrun.

The authoritative full dev comparison is `2026-10-27T00-11-38-494Z-178b74dc`, executed from committed source `7798fce7154d`.
The earlier deterministic-only run `2026-10-26T23-51-57-875Z-c535259f` is retained as supporting evidence.
It evaluates all 102 curated matching cases and all 2,363 bulk matching cases in dev.
The exact adapter has no estimator, so macro predictions are unavailable.
No holdout cases have been evaluated.
Jev completed all 2,712 selected dev cases with 2,957 requests, no sampling, no retries, no unknown usage, and $0.10539795 of cumulative reported spend.
All 5,177 method/case predictions and raw provider exchanges are retained in the full comparison directory.

`2026-10-26T23-39-45-636Z-164cfb7a` is the initial candidate's dev smoke result before equivalent-serving grouping was repaired.
`2026-10-26T23-45-29-548Z-39d547e4` is a diagnostic dev result from uncommitted repair inputs; it is not the authoritative baseline.
Missing-key `failure.json` receipts are failed preflights and contain no provider predictions or billed usage.
Retain these records as construction history rather than mixing their populations with the repaired baseline.

Future explicit Jev invocations append to the existing cumulative `spend.jsonl` history and create a new run directory.
Never overwrite the prior baseline or reset spending history.

Additional deterministic smoke runs diagnose and verify offline cost reporting.
Their per-run cost is zero; cumulative provider spend is unavailable in current offline reports, and `spend.jsonl` remains the authoritative cumulative ledger.
