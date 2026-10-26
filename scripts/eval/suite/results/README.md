**TL;DR:** Exact matching ran on dev; live Jev is waiting for the authorized TYPESAFE_API_KEY.

The authoritative repaired-suite dev baseline is `2026-10-26T23-51-57-875Z-c535259f`, executed from committed source `7883c7a3fb2a`.
It evaluates all 102 curated matching cases and all 2,363 bulk matching cases in dev.
The exact adapter has no estimator, so macro predictions are unavailable.
No holdout cases have been evaluated and no Jev requests have been sent; actual Jev spend is $0.

`2026-10-26T23-39-45-636Z-164cfb7a` is the initial candidate's dev smoke result before equivalent-serving grouping was repaired.
`2026-10-26T23-45-29-548Z-39d547e4` is a diagnostic dev result from uncommitted repair inputs; it is not the authoritative baseline.
Missing-key `failure.json` receipts are failed preflights and contain no provider predictions or billed usage.
Retain these records as construction history rather than mixing their populations with the repaired baseline.

A future explicit Jev dev invocation will append its cumulative budget receipts to `spend.jsonl` and create a new run directory.
Never overwrite the prior baseline or reset spending history.
