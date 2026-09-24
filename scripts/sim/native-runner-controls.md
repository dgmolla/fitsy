# Native runner controls

Use the build, run and finish sequence in [shipping.md](../../docs/engineering/devops/shipping.md).
Set `FITSY_SIM_OWNER` and pass the owned simulator UDID.
The runner checks source, app and public configuration hashes, simulator state, installed app, disk headroom and the owned Metro process before starting each Maestro flow.
It refuses a busy Metro port and never stops another worker's server.
The build and run phases need 8 GiB free on the Data volume before admission.
If admission fails, clear only proven task-owned disposable data at an idle boundary and retry.

Each run writes `.evidence/product-flow/runner-timeline.jsonl` with wall and monotonic runner boundaries.
Each flow retains its original Maestro command JSON, untrimmed `flow-untrimmed.mp4`, screenshots, recorder log and a derived `timing-summary.json`.
The summary lists command condition, declared deadline, outcome and actual retry attempt only when exposed by Maestro.
Command monotonic timestamps are estimates anchored to the runner clock; Maestro supplies wall timestamps and durations.
An uncovered command interval is unobserved time, not measured app or recorder idle.
If any command lacks a timestamp or duration, aggregate uncovered time and recording first/last offsets are unknown, and no gap alert is raised.
Overlapping command intervals must not be added together.

The runner allows at least 15 minutes per flow and also budgets three times the sum of declared YAML waits plus 10 minutes for driver overhead.
Its inactivity limit is at least three minutes and at least two minutes longer than the longest declared wait.
These limits never change a product selector timeout or skip an assertion.
Before stopping a stalled flow, it saves a simulator screenshot and watchdog receipt, then signals only the process group it spawned.
The owned recorder stops when that flow ends or fails.
If a command fails, inspect `failure.json`, `failure-screen.png`, the original command JSON, Maestro log and untrimmed video.
The failed command hierarchy remains in the raw JSON when Maestro exposes it; the failure summary records its absence otherwise.
Network timing is reported only as redacted HTTP status and duration pairs found in the log, with an explicit absence when none exist.

The runner archives previous raw product-flow evidence under `.evidence/resume/product-flow-*` before a new run.
After two matching failures it writes `.evidence/resume/diagnosis-checkpoint.json` and refuses another blind retry.
Inspect both attempts, then write a JSON diagnosis with `cause`, `counterfactual` and `evidence` fields and set `FITSY_DIAGNOSIS_CHECKPOINT` to that file for the repaired run.
Do not use a diagnosis file as a substitute for an actual repair or native recheck.

Adopt a new runner commit only when the current simulator owner has finished its active native phase and released the claim.
Record the exact commit and rebuild when the build recipe, mobile source or public configuration identity changes.
Runner and test changes invalidate the full source hash, so generate a fresh report and publish `product-flow/local` for the exact PR head when the shipping plan requires product evidence.
An existing worker has not adopted these controls until its own runner timeline and source-bound receipt show the new commit.
