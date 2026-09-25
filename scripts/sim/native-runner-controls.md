# Native runner controls

Use the build, run and finish sequence in [shipping.md](../../docs/engineering/devops/shipping.md).
Set `FITSY_SIM_OWNER` and pass the owned simulator UDID.
The runner checks source, app and public configuration hashes, simulator state, installed app, disk headroom and the owned Metro process before starting each Maestro flow.
Development and review `run` invocations default to `--mode=development`, which executes the same Maestro assertions and screenshots without starting the explicit recorder.
Use `--mode=final-candidate` once the PR candidate is stable for publication evidence.
Add `--record-video` when a complete video is specifically requested; final candidate runs otherwise retain command receipts and screenshots without starting the explicit recorder.
The flow helper requires an explicit boolean recording choice and fails before starting children if the CLI omits it.
The product-flow CLI passes its selected mode through `runSelectedRecordedFlow`, which supplies that boolean to the helper; a child-process fixture exercises both CLI choices through this production bridge.
An entrypoint subprocess also checks that `run --record-video` enters its recording-tool preflight before any native work, while an ordinary `run` does not.
Repeating that run reuses a passing, unexpired report only when the current source, app, backend, simulator, fixture and selected flow receipts still validate.
Use `--mode=requested-video` only for an explicit video request; that report is diagnostic and cannot pass the final candidate publication gate.
Install `ffprobe` and `ffmpeg` before a video run; the runner checks for them before Maestro and rejects a zero-duration video or one whose first video frame cannot decode, with a failure receipt after recording.
The validation decodes at most one frame with a 15-second limit and retains the complete original video.
It refuses a busy Metro port and never stops another worker's server.
The build and run phases enforce an 8 GiB free-space floor; the operational phase admission also checks the larger observed-draw requirement.
If admission fails, clear only proven task-owned disposable data at an idle boundary and retry.

Each run writes `.evidence/product-flow/runner-timeline.jsonl` with wall and monotonic runner boundaries.
Each flow retains its original Maestro command JSON, screenshots, an XCTest capture policy receipt and a derived `timing-summary.json`.
Video modes also retain the complete untrimmed `flow-untrimmed.mp4` and recorder log.
The runner scopes a local `xcodebuild` override to its owned Maestro process, changes only that process's temporary XCTest configuration from `screenRecording` to `screenshots`, and fails when no launch receipt proves the override.
This prevents Maestro's implicit XCTest video from silently replacing the disabled explicit recorder.
At each flow boundary, the runner snapshots the exact owned simulator's XCTest attachments and writes `xctest-attachment-closeout.json` with file and byte counts.
It recognizes extensionless QuickTime files by their header, checks for open attachment writers, and retires only videos created during that flow after their identity is rechecked.
An unexpected new video fails capture verification even when cleanup succeeds; inspect the capture receipt and recording source before retry.
Historical videos with unresolved ownership remain listed separately and require an owner-reconciled idle cleanup.
The final report and publication bind each successful flow's closeout receipt by hash.
The summary lists command condition, declared deadline, outcome and actual retry attempt only when exposed by Maestro.
Command monotonic timestamps are estimates anchored to the runner clock; Maestro supplies wall timestamps and durations.
An uncovered command interval is unobserved time, not measured app or recorder idle.
If any command lacks a timestamp or duration, aggregate uncovered time and recording first/last offsets are unknown, and no gap alert is raised.
Overlapping command intervals must not be added together.

The runner allows at least 15 minutes per flow and also budgets three times the sum of declared YAML waits plus 10 minutes for driver overhead.
Its inactivity limit is at least three minutes and at least two minutes longer than the longest declared wait.
These limits never change a product selector timeout or skip an assertion.
Before stopping a stalled flow, it saves a simulator screenshot and a numbered diagnostic receipt.
Each Maestro and recorder invocation has a live, per-invocation keeper that owns its process group.
The runner sends bounded signal requests to that keeper and never signals a bare group ID after its owner exits.
Maestro receives TERM after diagnostics, then KILL if same-group children remain after the grace period.
The owned recorder receives INT when the flow ends or fails, then TERM and KILL only if same-group children remain.
After its OS members exit, the runner keeps the keeper IPC open for a bounded child exit receipt before closing it.
If that receipt is absent after five seconds, the recording fails with `no exit receipt`, and cleanup addresses only the still-owned group.
The Maestro watchdog uses the same receipt order after TERM.
If the keeper observes recorder exit before accepting a stop request, the runner records `recorder-early-exit`, captures flow diagnostics, stops its owned Maestro group and fails with `recorder-ended-early` even when the recorder exit code is zero and the partial video has bytes.
The recorder keeper acknowledges stop with whether it had already observed child exit, so a delayed exit IPC message cannot turn a partial recording into a pass.
The keeper stamps its child exit observation before sending IPC, and the recording end field uses that stamp even when diagnostics or IPC delivery finish later.
The stamp is the keeper's observation of process exit, not the exact last video frame; a missing exit receipt leaves the recording end and derived offsets unknown.
If a Maestro watchdog fires before the early recorder exit is observed, `recorder-ended-early` is the final flow, failure and timing reason; the watchdog trigger is retained as `priorReason` and in its own diagnostic receipt.
Each diagnostic has a separate numbered JSON and screenshot path, so a later recorder diagnostic does not overwrite the watchdog evidence.
The handshake orders keeper observations; it cannot infer the operating system's exact exit instant if exit and stop race before either is observed.
Inspect the recorder log and preserved partial video, repair the recording failure, then rerun the complete flow.
The runner waits for command and descendant exit separately from keeper exit.
If a successful Maestro command leaves same-group descendants, it records diagnostics and sends TERM to its proven owned group; prompt cleanup preserves the command pass, while descendants that outlive the grace period fail the flow.
An unexpected keeper exit fails with an ownership-loss diagnostic and no further group signal.
Children that create their own process group or session are outside this scoped cleanup guarantee.
If a command fails, inspect `failure.json`, `failure-screen.png`, the original command JSON, Maestro log and any video produced by the selected mode.
The failed command hierarchy remains in the raw JSON when Maestro exposes it; the failure summary records its absence otherwise.
Network timing is reported only as redacted HTTP status and duration pairs found in the log, with an explicit absence when none exist.

The runner archives previous raw product-flow evidence under `.evidence/resume/product-flow-*` before a new run.
After two matching failures it writes `.evidence/resume/diagnosis-checkpoint.json` and refuses another blind retry.
Inspect both attempts, then write a JSON diagnosis with `cause`, `counterfactual` and `evidence` fields and set `FITSY_DIAGNOSIS_CHECKPOINT` to that file for the repaired run.
Do not use a diagnosis file as a substitute for an actual repair or native recheck.

Adopt a new runner commit only when the current simulator owner has finished its active native phase and released the claim.
Record the exact commit and rebuild when the build recipe, mobile source or public configuration identity changes.
Runner and test changes invalidate evidence bound to a prior PR head, so generate a fresh report and publish `product-flow/local` for the exact PR head when the shipping plan requires product evidence.
The publisher rejects development and requested-video reports when final proof is required.
It rejects symlinked artifacts and parent directories, then compares each archived file's extracted bytes with the validated source, including every complete flow video when recording was requested.
An existing worker has not adopted these controls until its own runner timeline and source-bound receipt show the new commit.
Repeat identity includes flow, command kind, and normalized direct or nested targets; target and error text are hashed in derived history while original command receipts remain available for diagnosis.
