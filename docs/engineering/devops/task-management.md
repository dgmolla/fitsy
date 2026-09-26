# Task management and worker ownership

> **Status:** living · **Last verified:** 2026-09-26

## Authority

The [Fitsy Delivery GitHub Project](https://github.com/users/dgmolla/projects/1) is the authoritative queue for Fitsy deliverables.
GitHub issues hold outcomes, acceptance criteria, dependencies, ownership, and follow-ups.
The project records the current stage and explicit blocker fields, while pull requests and Actions provide source-bound delivery evidence.
Do not start a second writable backlog.
Existing authorized work continues under its existing owner during migration.

| System | Responsibility |
| --- | --- |
| GitHub Issues and Fitsy Delivery Project | Deliverable, priority, dependencies, acceptance, execution owner, current stage, and blockers. |
| FM or an explicitly delegated coordinator | Claim work, supervise workers, reconcile evidence, and update the same issue. |
| Repository and GitHub | Canonical checks, source-bound review, PR/merge identity, deployment and verification receipts. |
| Slack | Notifications linked to the issue and evidence; never a separate task queue. |

```mermaid
flowchart LR
  L[GitHub issue and project card] --> C[One dispatcher and execution owner]
  C --> W[Worker in isolated checkout]
  W --> G[Repository checks and GitHub delivery]
  G --> L
  L --> S[Material progress notification]
```

## One issue, one execution owner

Search for an existing issue before creating one.
Each independently testable deliverable records its outcome, acceptance criteria, priority, dependencies, owning role, execution owner, and applicable release surface.
Use the real GitHub issue number in branch and PR references.
Link related PRs, Actions runs, deployment receipts, and source-bound follow-up issues rather than copying raw logs or credentials into the project.
Apply existing PR scope and review rules from [shipping.md](shipping.md); this contract adds no approval or review gate.

One dispatcher assigns the execution owner before starting a worker.
An FM task delegated to a Codex coordinator remains owned by that coordinator until explicit transfer or completion; FM must not dispatch a competing implementation.
Parallel subtasks have explicit file/behavior boundaries and report to that owner.
Before transfer, persist current source, evidence, running operations, blockers and next action, confirm the prior owner stopped or released ownership, then record the successor.
An issue assignment alone is not an atomic process lock; use FM's supported ownership/session controls for runtime exclusion.
If ownership cannot be established, reconcile it before launching another worker.

## Stages and evidence

Use the project's existing `Queued`, `In flight`, and `Done` statuses instead of creating duplicates.

| Project status | Required meaning |
| --- | --- |
| Queued | Accepted work awaiting priority or dependencies. |
| In flight | A named execution owner is implementing, validating, reviewing, integrating, or verifying the release. |
| Done | Applicable main checks, release verification and acceptance passed, with linked receipts. |

Record ready, review, merge, and deployment milestones in the issue with the source-bound receipts, not as new project statuses.
Record blocked reason, blocker owner, next action, and next check separately from the current project status.
Documentation-only work records deployment as not applicable.
For mobile, distinguish OTA publication, native binary distribution, and observed device uptake; one does not establish the others.
P2/P3 follow-ups retain the source-bound disposition and named acceptance from the review contract; creating an issue alone does not satisfy that contract.

## Progress and elapsed time

Record actual UTC timestamps for request, ready, work start, PR opened, required gates ready, merged, deployed, and acceptance verified.
Preserve unknown historical values rather than substituting commit times or reconstructing imaginary work starts.
Report request-to-verified-delivery separately from PR-open-to-merge, queue time, active execution, and blocked time.
Do not sum overlapping reviewer/test durations and label the result wall time.
Update the issue at material transitions, failures, ownership changes, and completion.
For active work, publish a fresh checkpoint at the configured reporting interval; a missed checkpoint is a liveness signal, not permission to repeat stale progress.
Use one configured reporting path with stable event identities and confirmed delivery receipts.
Honor the task's communication authorization before sending external notifications.
If reporting is unavailable, record the gap in the active handoff and report it through the current user conversation.

## Worker lifecycle

A persistent FM supervisor may outlive many tasks; task workers must have a current purpose.
Use a fresh worker context for a new unrelated issue, preserving reusable evidence and repository state outside the conversation.
Resume the same issue only from its current compact handoff and verified source/evidence identities.
A paused worker records the hold reason, next owner/action, and explicit wake condition; pause its periodic progress reporting.
Reconcile workers on completion and on the supervisor's normal heartbeat.
After recording completion, use FM's canonical teardown for the completed worker when no child work, owned running operation, pending delivery, or unrecorded evidence remains.
Keep a completed worker only for a documented recovery need with an owner and expiry/recheck condition.
Do not keep it idle indefinitely as a substitute for durable task state.
Do not kill workers solely because of elapsed age, and do not restart them to evade review budgets or erase failed attempts.
Worker retirement and worktree deletion are separate operations: preserve unmerged changes, source-bound evidence, review history, and release/rollback receipts.
Release simulator, Metro, database and other resource claims only through their ownership-aware procedures.

## Cutover and recovery

Inventory existing FM and local rollout items, then map each deliverable to an existing or newly created GitHub issue.
Preserve completed PR/deployment links and unresolved findings; do not import old completed generations as new work.
Store returned issue identifiers before attempting another create; reconcile uncertain writes before retrying.
Record verified dependencies and the single dispatcher, then mark the previous backlog as a reference to the Fitsy Delivery project.
Confirm issue reads, a real task update, owner reconciliation and the configured notification path before declaring the integration operational.
During an outage, preserve a bounded pending-update log keyed by issue and event identity under the current dispatcher.
Continue already-owned authorized work when safe; do not dispatch duplicate work or claim unsynchronized statuses were delivered.
Replay and reconcile the pending updates after recovery, retaining their original observed timestamps.
