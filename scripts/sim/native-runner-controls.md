# Native runner controls

Use the build, run and finish sequence in [shipping.md](../../docs/engineering/devops/shipping.md).
Set `FITSY_SIM_OWNER` and pass the owned simulator UDID.
The runner checks resolved native/profile identity, app and installed-app hashes, separate JavaScript and public configuration hashes, simulator state, disk headroom and the owned Metro process before starting each Maestro flow.
The [native binary reuse cookbook](../../docs/engineering/devops/native-binary-reuse.md) lists the exact compile cases and example decisions.
The normal build path checks optional shared immutable Debug artifacts after local receipts; imports preserve original receipt bytes and require current-source Metro and acceptance.
Use an absolute `FITSY_NATIVE_CACHE_DIR` for alternate local storage or `off` to retain the uncached path.
Development and review `run` invocations default to `--mode=development`, which executes the same Maestro assertions and screenshots without starting the explicit recorder.
Use `--mode=final-candidate` once the PR candidate is stable for publication evidence.
Run final acceptance directly against the current source and retain its app/backend/evidence identities.
Inspect `npm run verify:product-plan`; `run UDID` executes the affected journeys automatically and explicit names only add diagnostics.
The plan records omitted journeys and requires the selected YAML assertions without unrelated baseline runs.
Add `--record-video` when a complete video is specifically requested; final candidate runs otherwise retain command receipts and screenshots without starting the explicit recorder.
The flow helper requires an explicit boolean recording choice and fails before starting children if the CLI omits it.
The product-flow CLI passes its selected mode through `runSelectedRecordedFlow`, which supplies that boolean to the helper; a child-process fixture exercises both CLI choices through this production bridge.
An entrypoint subprocess also checks that `run --record-video` enters its recording-tool preflight before any native work, while an ordinary `run` does not.
Repeating that run reuses a passing, unexpired report only when the current source, app, backend, simulator, fixture and selected flow receipts still validate.
Use `--mode=requested-video` only for an explicit video request; that report is diagnostic and cannot pass the final candidate publication gate.
Install `ffprobe` and `ffmpeg` before a video run; the runner checks for them before Maestro and rejects a zero-duration video or one whose first video frame cannot decode, with a failure receipt after recording.
The validation decodes at most one frame with a 15-second limit and retains the complete original video.
It refuses a busy Metro port and never stops another worker's server.
Retire owned Metro, drivers and idle simulator resources through the existing lifecycle after the phase; keep acceptance evidence and another task's resources intact.
The build and run phases enforce an 8 GiB free-space floor.
If the free-space check fails, clear only proven task-owned disposable data at an idle boundary and retry.

## Host backend selection

The external Mac poller must select the backend before native preparation, Metro or account fixtures.
Run `node scripts/sim/preview-backend.mjs <full-checkout-head-sha>` from its candidate checkout with the local public environment loaded.
The read-only helper retains the configured backend when its API/shared/schema contents match.
When stable dev has different contents, it discovers a Ready `fitsy-api` preview in the existing team for that exact head and verifies its immutable URL, project, revision, deployment ID and clean source through the ordinary native backend check.
An explicit mismatched preview, missing deployment or failed inspection stops execution; stable dev is never a fallback for incompatible source.

The existing host owner must apply the returned `backend` to both its fixture/Maestro environment and its native/Metro environment, set `EXPO_NO_DOTENV=1`, and retain the returned JSON in the run's evidence directory.
Apply this once before starting children so all accounts and saved helpers use the same origin.
Keep the selected deployment pinned through acceptance and retain the original failed run separately.
This does not change `dev.fitsy.org`, publish a deployment, grant access or replace any flow assertion.
The helper's subprocess regressions run with `npm test -w @fitsy/scripts -- --runInBand --runTestsByPath sim/preview-backend.test.ts sim/backend-identity.test.ts`.
Changing this repository helper alone does not install the external poller hook; verify that the installed owner consumes it before another native replay.

## Optional Slack previews

The local scripted gate accepts `--record-video` or `FITSY_SIM_RECORD_VIDEO=1` to add best-effort preview evidence around each selected Maestro invocation.
Recording is off by default, and `--plan` and scope `none` never launch recording tools.
The gate's flow selection, assertions, exit result, device lease and dev-target checks retain their existing contracts.
These previews are separate from explicitly requested complete product-acceptance videos described above.

`slack-video.mjs` starts `xcrun simctl io <UDID> recordVideo --type=mp4` against the selected device, never the ambiguous `booted` alias.
It captures at most the first 90 seconds of the invocation, then accelerates longer captures into a silent H.264 MP4 of at most 30 seconds, at 360 pixels wide and 12 fps.
The recorder starts alongside Maestro with no readiness delay.
Finalization signals only its directly owned recorder process, with INT, TERM and KILL grace periods totaling at most 1.25 seconds.
FFprobe has a one-second deadline per probe and FFmpeg encoding has a five-second deadline and one encoder thread.
Missing tools, early exit, invalid media, oversized output, interruption and evidence-write errors are advisory and cannot replace Maestro's return value or original exception.
Operator interruption still stops the wrapped command and returns a failing exit status.

Only a finalized nonempty preview strictly below 10,000,000 bytes gets a public `flow-preview-*.mp4` filename beside the run's screenshots.
Each attempt also writes an advisory `.mp4.json` receipt and recorder `.mp4.log`.
Raw captures and incomplete encodes use other suffixes in a private temporary subdirectory, so the existing Slack glob cannot select them.
Those intermediates are removed after recorder exit; an unconfirmed recorder exit retains them for the owner to diagnose.
The preview is a short sample and cannot establish full-journey or release acceptance.

The existing Mac poller at `~/fitsy-refactor/sim-review/poller.mjs` invokes Maestro directly, so its owner must adopt this wrapper at an idle runner boundary.
Replace only the selected saved-flow `run('maestro', args, options)` call with the following argument shape, preserving its existing args, environment, timeout and result handling:

```js
const videoWrapper = join(wt, 'scripts/sim/slack-video.mjs');
const videoArgs = existsSync(videoWrapper)
  ? [videoWrapper, '--record-video', `--udid=${udid}`, `--dir=${ev}`, '--', 'maestro'] : [];
run(videoArgs.length ? process.execPath : 'maestro', [...videoArgs, ...args], options);
```

The existence check preserves the original Maestro invocation for older PR heads that predate the helper.
This wraps the already selected flows without adding fixture setup, new journeys, a publisher or a schedule.
For a grouped Maestro invocation, the preview samples the first 90 seconds of that group; the local scripted gate saves a separate preview for each selected journey.
Keep `ev` at `~/fitsy-refactor/sim-review/evidence/<head-sha-prefix>` so `~/fitsy-refactor/loop/evidence.py` finds the MP4 recursively with the existing screenshots on merge.
That publisher already enforces the same decimal size limit and needs no Slack API or credential changes.
External poller adoption and a real simulator run are separate from the repository's wrapper tests.
Replay deterministic regressions with `npm test -w @fitsy/scripts -- --runInBand --runTestsByPath sim/slack-video.test.ts sim/ci.test.ts`.
The canonical local media-integration check includes the real FFmpeg preview test; the ordinary scripts suite skips that real-media case when `FITSY_MEDIA_INTEGRATION=0`.

## Product acceptance evidence

Each run writes `.evidence/product-flow/runner-timeline.jsonl` with wall and monotonic runner boundaries.
Each flow retains its original Maestro command JSON, screenshots, an XCTest capture policy receipt and a derived `timing-summary.json`.
Video modes also retain the complete untrimmed `flow-untrimmed.mp4` and recorder log.
The runner scopes a local `xcodebuild` override to its owned Maestro process, changes only that process's temporary XCTest configuration from `screenRecording` to `screenshots`, and fails when no launch receipt proves the override.
This prevents Maestro's implicit XCTest video from silently replacing the disabled explicit recorder.
At each flow boundary, the runner snapshots the exact owned simulator's XCTest attachments and writes `xctest-attachment-closeout.json` with file and byte counts.
It uses a QuickTime-compatible header to select candidates, then requires a positively probed video stream, a clean writer-idle scan, and an exact-file identity recheck immediately before retiring only current-flow videos.
Audio-only, unknown, unprobeable and historical attachments are preserved; an `lsof` warning or scan error blocks retirement rather than proving idleness.
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
Record the exact commit for acceptance, and rebuild only when the resolved native inputs, required profile or verified artifact integrity demands it.
Runner and test changes invalidate evidence bound to a prior PR head, so generate a fresh report and publish `product-flow/local` for the exact PR head when the shipping plan requires product evidence.
The publisher rejects development and requested-video reports when final proof is required.
It rejects symlinked artifacts and parent directories, then compares each archived file's extracted bytes with the validated source, including every complete flow video when recording was requested.
An existing worker has not adopted these controls until its own runner timeline and source-bound receipt show the new commit.
Repeat identity includes flow, command kind, and normalized direct or nested targets; target and error text are hashed in derived history while original command receipts remain available for diagnosis.
