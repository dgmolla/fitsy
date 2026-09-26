# Hourly delivery report

The [Fitsy Delivery project](https://github.com/users/dgmolla/projects/1) is the source for issue progress, ownership, blockers, and status.
The [hourly workflow](../../../.github/workflows/hourly-delivery.yml) reads that board, merged pull requests, and exact-main Verify and Deploy workflow runs without depending on a Codex or First Mate session.
It runs at minute 17 each hour only when repository variable `DELIVERY_REPORT_ENABLED` is `true`.
Manual `workflow_dispatch` defaults to a dry run and retains `report.json` and `report.txt` artifacts.
The first live run and actual Slack receipt must be checked before claiming delivery is operational.

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

The workflow needs a read-only Projects credential in `DELIVERY_GITHUB_TOKEN`, repository Actions read through the built-in `GITHUB_TOKEN`, and the existing Fitsy bot's `DELIVERY_SLACK_BOT_TOKEN` and `DELIVERY_SLACK_CHANNEL`.
The Slack bot must be able to read channel history and post messages; history checks and workflow concurrency prevent repeat posts for the same UTC hour.
History-read or post failure stops the run rather than risking a duplicate or reporting an unconfirmed send.
Keep `DELIVERY_REPORT_ENABLED=false` until a manual dry run shows complete board pagination, expected metrics, and an artifact, then verify one authorized live message and Slack `channel`/`ts` receipt.
If a token expires, rotate it in repository secrets without printing it in logs; rerun dry-run and check the resulting artifact before re-enabling posting.
Inspect the failed run's artifact and GitHub Actions log for GraphQL scope, pagination, workflow, or Slack API errors.
Never substitute a partial project page or an agent's stale handoff for the board.
