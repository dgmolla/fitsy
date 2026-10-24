# Sprint

## Role and authority

You coordinate the [Fitsy Delivery GitHub Project](https://github.com/users/dgmolla/projects/1) when the user runs `/sprint`.
Read [task management](../../docs/engineering/devops/task-management.md) for issue ownership and [shipping](../../docs/engineering/devops/shipping.md) for implementation, review, and release gates.
The project and its GitHub issues are the single writable delivery queue.
Treat `proj-mgmt/` as historical planning and objective reference, not a board to advance or archive.
Do not create or update a local sprint board.
Keep any already authorized execution owner until a recorded transfer or completion.

## Read the current state

Use the live project, issues, and pull requests before selecting work:

```sh
gh project view 1 --owner dgmolla --format json
gh project field-list 1 --owner dgmolla --format json
gh project item-list 1 --owner dgmolla --format json --limit 100
gh issue list -R dgmolla/fitsy --state open --limit 100
gh pr list -R dgmolla/fitsy --state open --limit 100
```

Read each candidate issue's acceptance criteria, dependencies, blocker, owner, linked PRs, and latest evidence.
Check current worker and branch ownership before dispatch so two workers cannot implement the same issue.
If project access is unavailable, report the access failure and retain the current owner; do not substitute `proj-mgmt/` as a writable queue.
Do not infer progress from an old card or merge alone.

## Select and execute work

Choose a `Queued` issue whose prerequisites are verified and whose scope is accepted.
Search the project and repository for an existing matching issue before creating a new one.
Record one execution owner and the actual work start on the issue before moving its project item to `In flight`.
Use the issue number in branch and PR references, and link source-bound checks, review findings, merge, deployment, and acceptance evidence back to that issue.
Run the repository's canonical shipping procedure; this command adds no review, approval, or merge gate.
Respect the task's existing authorization and any still-applicable human gate in `CLAUDE.md` without weakening the canonical shipping rules.

The project has exactly three statuses:

| Status | When to use it |
| --- | --- |
| `Queued` | Accepted work awaits dispatch or a dependency. |
| `In flight` | A named owner is implementing, reviewing, merging, deploying, or verifying acceptance. |
| `Done` | Applicable main checks, release verification, and acceptance have passed with linked receipts. |

Record blockers and finer milestones on the issue and in the project's existing blocker and dependency fields.
A merged PR is not by itself a `Done` outcome.
For a blocked issue, keep its last accurate status, identify the blocker and next check, and select another ready issue only after preserving ownership.

To move an existing card, use `gh project view` for the project ID, `gh project field-list` for the current Status field and option IDs, and `gh project item-list` for the matching issue's item ID.
Then update that item through `gh project item-edit --id <item-id> --project-id <project-id> --field-id <status-field-id> --single-select-option-id <option-id>`.
Read the item again to confirm the new status; do not invent IDs or update a different card with a similar title.
Use `gh issue edit` or an issue comment for issue details and link receipts as appropriate.

## Sprint checkpoint

Summarize what reached `Done`, what remains `In flight`, what is blocked, and the next dependency-ready `Queued` issues from the live project.
Include actual timestamps and links rather than reconstructing historical start times.
Use `proj-mgmt/okrs.md` only as reference when discussing objectives; do not rewrite it as a task queue.
At a boundary, propose priority changes on the existing GitHub issues and project cards.
Do not create a new local sprint board, revive a completed generation as new work, or dispatch a competing worker.
Tell the user what is running and which evidence or decision will close the next milestone.
