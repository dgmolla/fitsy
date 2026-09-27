# Half-hour delivery report

The [Fitsy Delivery project](https://github.com/users/dgmolla/projects/1) is the source for issue progress, ownership, blockers, and status.
The [delivery workflow](../../../.github/workflows/hourly-delivery.yml) reads that board, merged pull requests, and exact-main Verify and Deploy workflow runs without depending on a Codex or First Mate session.
It requests runs at UTC minutes 17 and 47 when repository variable `DELIVERY_REPORT_ENABLED` is `true`.
Manual `workflow_dispatch` defaults to a dry run and retains `report.json` and `report.txt` artifacts.
Slack shows the slot and main gate state, then short Shipped, Next, and Blocker lines.
The JSON artifact retains PR throughput, observed local phase time, timing coverage exceptions, and full evidence.
Shipped lists at most two Done issues with valid Verified at timestamps from the past 24 hours, ordered by verification time.
Next lists at most two unblocked In flight issues first, then unblocked queued Now or Next issues; the title is shortened and links to the issue.
The `Details` link carries a UTC half-hour slot marker, `fitsy-slot:YYYY-MM-DDTHH:00` or `:30`.
Schedule and fallback dispatches share the workflow concurrency group and Slack history check, so a second run for one slot does not send another digest.
The history check also recognizes an older `fitsy-hour` message sent within the same slot during migration.
The first live run and actual Slack receipt must be checked before claiming delivery is operational.

GitHub scheduled runs are best effort: the September 26 minute-17 run began at 21:58 UTC, 41 minutes late, and the September 27 run began at 00:40 UTC, 23 minutes late; some expected hourly runs are absent.
GitHub does not expose the intended triggering hour for a delayed schedule, so a scheduled run reports the current UTC half-hour when it actually starts.
The fallback may explicitly report the previous missed slot within 60 minutes; both paths use the same marker and Slack history check.
The existing 30-minute Codex heartbeat may dispatch this same workflow with `dry_run=false` and an explicit `slot` such as `2026-09-27T02:30` when that slot lacks a confirmed report.
An explicit slot must be a current or previous UTC half-hour no more than 60 minutes old; stale dispatches fail rather than posting old progress.
The heartbeat must not post a separate digest or install a second publisher.
Keep the fallback owner and its next due time in the active task handoff, and verify one Slack `channel`/`ts` receipt after activation.

## Issue field protocol

The execution owner records `Started at` as the observed ISO UTC time when work actually starts.
At each material checkpoint or blocker, update `Progress`, `Next action`, `Last progress at`, and the existing Blocker/Dependencies fields on the same project item.
Record `Verified at` only when acceptance and applicable main Verify, Deploy, and release receipts are complete.
Merging a PR, closing an issue, or seeing a successful Deploy workflow alone does not establish verified delivery.
Do not backfill unknown historical start or verification times from commits or issue updates.
The reporter counts missing or invalid timestamps as unknown, never as zero duration.
Issue cycle uses only valid `Started at` to `Verified at` pairs on Done issues; WIP age uses actual `Started at` on In flight issues.
PR-open-to-merge is a separate 24-hour sample of pull requests merged into `main`.
Board counts are cards, which may include both an issue and its linked PR; do not interpret them as unique delivered tasks.

## Activation and failure handling

Create the `delivery-report` GitHub Actions environment and restrict deployment branches to `main` before adding credentials.
Store a read-only Projects credential as that environment's `DELIVERY_GITHUB_TOKEN` secret and the existing Fitsy bot token as its `DELIVERY_SLACK_BOT_TOKEN` secret.
Remove any repository-level copies of those secrets so unreviewed workflows cannot read them.
The workflow uses the built-in `GITHUB_TOKEN` for repository Actions and pull-request reads, and repository variable `DELIVERY_SLACK_CHANNEL` for the destination.
The Slack bot must be able to read channel history and post messages; history checks and workflow concurrency prevent repeat posts for the same UTC half-hour slot.
History-read or post failure stops the run rather than risking a duplicate or reporting an unconfirmed send.
Keep `DELIVERY_REPORT_ENABLED=false` until a manual dry run shows complete board pagination, expected metrics, and an artifact, then verify one authorized live message and Slack `channel`/`ts` receipt.
If a token expires, rotate it in the restricted environment secrets without printing it in logs; rerun dry-run and check the resulting artifact before re-enabling posting.
Inspect the failed run's artifact and GitHub Actions log for GraphQL scope, pagination, workflow, or Slack API errors.
Never substitute a partial project page or an agent's stale handoff for the board.

## Local phases and review hardening

The hosted report reads structured writer-authored issue comments; it never connects to a worker machine.
Local instrumentation publishes observed attempts with stable run identities.
Unknown historical implementation time stays unknown.
The rolling 24-hour phase totals sum each issue's interval union, clipping work at the window boundary.
They are summed issue time, not global elapsed time or billed compute.
UT is part of local verification and must not be added to it.
Cached and skipped attempts contribute no execution time; running attempts stay unfinished rather than estimating a completed duration.
The JSON artifact includes failed attempts, each source review round's wall time and summed lens effort, and issue evidence links.
Coverage shows active issues with observations; stale means the latest published run checkpoint is over two hours old.
Coverage does not certify that every command was instrumented.
Malformed, untrusted or duplicate run summaries are excluded and counted as invalid.

At each review closeout, the owner records either an evidence-backed pipeline improvement or an explicit explanation that no new hardening was needed.
A confirmed finding should link its fix, regression detector, prevention mechanism, and verification evidence.
Do not manufacture changes or count queued follow-ups as improvements.
Publish each accepted improvement as a writer-authored issue comment using this contract:

````markdown
<!-- fitsy-improvement:v1:unique-finding-id -->
```json
{"v":1,"id":"unique-finding-id","issue":355,"category":"regression","pr":123,"finding":"Confirmed failure mechanism","prevention":"How recurrence is constrained","detector_path":"scripts/example.test.mjs","prevention_path":"scripts/example.mjs","verify_run":1234,"deploy_run":1235}
```
````

Categories are `speed`, `regression`, `diagnostics`, `recovery`, and `security`.
Use one stable finding ID per fix PR, retaining it when correcting a record.
The reporter counts records only after the fix PR merges into main, both named main Verify and Deploy runs succeed at its exact merge SHA, and detector/prevention files exist at that revision.
This verifies shipment and file evidence; the independent review remains responsible for whether the detector and prevention address the finding.
Counts cover active issues and issues verified in the past 24 hours, with successful gate completion in the same window.
The issue comment and report artifact retain the detailed evidence; Slack carries only category totals.
