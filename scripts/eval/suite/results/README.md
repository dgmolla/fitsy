**TL;DR:** Original and affected-dev comparisons total $0.12394053; holdout remains unrun.

The authoritative original-v1 full dev comparison is `2026-10-27T00-11-38-494Z-178b74dc`, executed from committed source `7798fce7154d`.
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

The measured extension's affected-dev comparison is `2026-10-27T01-10-06-197Z-2e7de0b8`, from committed source `75bf11f867574757af486115fd7d295c3d2d7806`.
It evaluates all 386 affected/new dev cases with both methods, making 404 new Jev requests and reusing 61 exact paid requests.
The run costs $0.01854258; cumulative Jev spend is $0.12394053 with no unknown usage.
`replay-audit.json` verifies no repeated paid request inputs and preserves the complete earlier ledger prefix.
This subset has its own denominators and must not be combined with the original full-population rates as if it were a new complete-suite run.
The deterministic-only `2026-10-27T00-58-34-262Z-5864b395` is an uncommitted-source construction diagnostic, superseded for this selection by the committed combined run.
