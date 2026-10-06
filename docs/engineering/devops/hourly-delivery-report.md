# Half-hour delivery report

The [Fitsy Delivery project](https://github.com/users/dgmolla/projects/1) is the source for issue progress, ownership, blockers, and status.
The local [publisher](../../../scripts/delivery/local-report.py) wakes once a minute without a Codex or First Mate session and makes UTC half-hour slots eligible at minute 02 and 32.
It reads the complete GitHub board through the installed dispatcher snapshot and shared quota cooldown, merged pull requests, exact-main Verify and Deploy runs, writer-authored timing comments, and explicitly registered local phase ledgers.
The [GitHub workflow](../../../.github/workflows/hourly-delivery.yml) is manual, dry-run-only diagnostics and never publishes Slack messages.
Slack shows the slot and main gate state, followed by three or four concise free-form editorial bullets.
The coordinator atomically writes authored_at, bullets and observed board_bindings in the private editorial-update.json under publisher.lock.
The publisher accepts only fresh compact prose whose issue-status bindings still match the complete current board read.
Explicit issue-number or Fitsy issue-URL references in a bullet must have a current binding as well.
Expired or malformed prose falls back to current actionable board facts without a human mention or a fixed backlog-blocker slot.
Issue numbers supplement product names and outcomes; merged code and an active process do not prove acceptance.
The JSON artifact retains PR throughput, observed local phase time, timing coverage exceptions, and full evidence.
The structured JSON shipped summary lists at most two Done issues with valid Verified at timestamps from the past 24 hours, ordered by verification time.
The structured JSON next summary lists at most two unblocked In flight issues first, then unblocked queued Now or Next issues; the title is shortened and links to the issue.
The `Details` link carries a UTC half-hour slot marker, `fitsy-slot:YYYY-MM-DDTHH:00` or `:30`.
The local publisher holds one process lock, reads Slack history before posting, and saves a confirmed `channel`/`ts` receipt for each slot.
History pagination advances one page per timer wake through the shared Slack limiter.
An uncertain send is reconciled by the same marker and stable Slack client message ID before any retry.
The history check also recognizes an older `fitsy-hour` message sent within the same slot during migration.
The first live run and actual Slack receipt must be checked before claiming delivery is operational.

GitHub scheduled runs proved unsuitable as a timer: the September 26 minute-17 run began 41 minutes late, the September 27 run began 23 minutes late, and some expected runs were absent.
The local timer may recover an undelivered previous slot while it is no more than 60 minutes old; older gaps remain visible in the receipt directory and are not mislabeled as current progress.
Slack's shared limiter and `Retry-After` set the next eligible attempt, and each timer wake makes at most one attempt per due slot.
The timer makes no model call and does not use a Codex heartbeat.

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

After the reviewed change merges, confirm `main` no longer has the workflow schedule before installing the local LaunchAgent.
Install the reviewed canonical dispatcher reader before the publisher runtime; a missing or busy reader defers reporting without sending.
Run `bash scripts/delivery/install-local-report.sh --check --timing-root /absolute/owned/worktree`, then install with `--install` and the same explicit timing roots.
The installer copies only the reporter runtime into `~/.fitsy-delivery`, retains receipts across reinstalls, and starts `com.fitsy.local-delivery-report`.
The timer uses the GitHub CLI keyring token with Projects scope and the existing Fitsy Slack bot credential through the shared local Slack limiter; it does not copy either secret into the repository or timer configuration.
Each timing root must have an issue-bound `.evidence/delivery/binding.json`; register only owned real worktrees, never test fixtures.
The local state directory contains private configuration, per-slot `report.json` and `report.txt`, receipt or pending retry state, and `launchd.log`.
On an error, inspect those files and the next eligible retry time; do not clear an uncertain receipt or repost with a new marker.
After installation, verify the first slot's actual Slack `channel` and `ts`, then retire any temporary heartbeat dispatcher without installing a second digest publisher.
Use `bash scripts/delivery/install-local-report.sh --uninstall` to stop the job while preserving receipts; restoring the previous manual workflow does not automatically resume scheduled posting.
Never substitute a partial project page or an agent's stale handoff for the board.

## Local phases and review hardening

The local report reads structured writer-authored issue comments and the explicitly registered local phase ledgers.
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
