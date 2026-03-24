# Sprint

## Role

You are the sprint coordinator. When the user runs `/sprint`,
you resume the current sprint, start a new one, or transition
between sprints — based on the current board state.

## What to Do

### 1. Read the current state

- Read `proj-mgmt/sprint.md` to find the current sprint
  (`<!-- CURRENT_SPRINT: -->` pointer)
- Read the current sprint board
- Read `CLAUDE.md` for project context and knob settings
- Read `proj-mgmt/okrs.md` for current objectives

### 2. Determine what to do

**If the current sprint has tasks in Backlog:**

This is a fresh sprint. Begin execution:

1. Identify Wave 1 tasks (no dependencies, no `^dep-` tags, or
   all dependencies are in Done)
2. List the tasks and which agent role handles each
3. Tell the user what's about to happen:
   > Starting Sprint {N}: {theme}
   >
   > **Wave 1** ({count} tasks, parallel):
   > - S-XX: {description} → {role}
   > - S-XX: {description} → {role}
   >
   > I'll work through Wave 1 now.
4. Execute Wave 1 tasks using the task execution flow (see §3)
5. After Wave 1 is complete, check for Wave 2 tasks and continue

**If all tasks are in Done:**

The sprint is complete. Run the sprint review:

1. Tell the user the sprint is complete
2. Run the sprint review process (see sprint board checklist):
   - CTO: harness metrics, gap evaluation, CLAUDE.md update
   - PM: OKR progress, sprint archival, next sprint board
3. Present the sprint summary to the human for review
4. After human reviews, create the next sprint board
5. Tell the user:
   > Sprint {N} complete. Sprint {N+1} is ready.
   > Run `/sprint` when you're ready to begin.

**If tasks are in In Progress:**

Resume the sprint. Pick up where things left off:

1. Check which tasks are in progress and their state
2. Check for open PRs — run the review loop on any unmerged PRs
3. Check for completed Wave tasks that unblock the next wave
4. Continue execution from the current state

### 3. Task execution flow

For each task, follow this flow. This is the core loop.

#### a. Implement

1. Move card: Backlog → In Progress
2. Create a branch: `s-{N}/{short-description}`
3. Write spec/design doc first (per spec-requirement knob)
4. Implement the task
5. Run pre-PR gates locally: `bash scripts/structural-tests.sh`
   (skip npm/tsc/build gates if no `package.json` exists)
6. Commit and push
7. Create PR via `gh pr create`

#### b. Review (spawn fresh reviewer agent)

Spawn a **separate Agent** (subagent) for review. This gives the
reviewer fresh context — it hasn't seen your implementation thinking.
The reviewer is read-only: it cannot edit files.

```
Agent(
  description: "Review PR #{N} as {role}",
  prompt: """
    You are the **{role}** reviewer for PR #{N}.

    Read your role definition from .claude/agents/{role}.md
    Read the review guidelines from .claude/agents/reviewer.md
    Read CLAUDE.md for project context.

    Review the PR:
    1. Run: git diff origin/main...HEAD
    2. Read any source files you need for full context
    3. Check against your role-specific and general review checklists

    Post your review on the PR:
    - If approving: gh pr review {N} --approve --body "your review"
    - If requesting changes: gh pr review {N} --comment --body "your review"

    End your review with EXACTLY one of:
    VERDICT: APPROVE
    VERDICT: CHANGES REQUESTED
    VERDICT: BLOCK
  """,
  allowedTools: "Read,Glob,Grep,Bash(git diff *),Bash(git log *),Bash(gh pr review *),Bash(gh pr comment *)"
)
```

#### c. Handle verdict

- **APPROVE**: Move to merge (step d)
- **CHANGES REQUESTED**: Fix in current session (you have full
  context from implementation). Then:
  1. Make the fixes
  2. Run gates locally
  3. Commit and push
  4. Spawn a **fresh** reviewer agent (step b) — never re-use
     the previous reviewer's session
  5. Max 5 review rounds. If stuck, tell the user and stop.
- **BLOCK**: Stop and tell the user. Do not attempt to fix.

#### d. Merge

1. Wait for CI to pass: poll `gh pr checks {N}` until green
2. Merge: `gh pr merge {N} --squash --delete-branch`
3. Move card: In Progress → Done, add `@completed(YYYY-MM-DD)`

### 4. Respect the knobs

Read `Shipyard Settings` from CLAUDE.md and follow them:

- **human-review-gate**: Determines when to wait for human review
  - `yolo`: No human review at all. Fully autonomous.
  - `cruise`: Don't wait for human intra-sprint. Human reviews at sprint end.
  - `specs-only`: Wait for human to approve specs before implementing
  - `specs-and-prs`: Wait for human on specs AND implementation PRs

- **spec-requirement**: Determines when to write specs
  - `always`: Write a spec for every task
  - `danger-zones`: Only write specs for danger zone tasks
  - `never`: Skip specs, implement directly

- **auto-merge**: Determines merge behavior
  - `on-approval`: Merge when agent review approves
  - `human-gate`: Wait for human to merge
  - `danger-zone-gate`: Auto-merge normal, human-gate for danger zones

- **wave-progression**: Determines wave advancement
  - `auto`: Start next wave when current wave is done
  - `human-gate`: Wait for human approval between waves

### 5. Move cards

As tasks progress, update the sprint board:
- Move from Backlog → In Progress when starting
- Move from In Progress → Done when PR is merged
- Add `@completed(YYYY-MM-DD)` to completed tasks

## Important

- Always read the current sprint state before doing anything
- Follow the knob settings — they control the pace
- Move cards on the board as you work
- Tell the user what's happening at each wave boundary
- Reviewers are always fresh agents — never self-review
- Only modify files in the task's domain (single-domain PRs)
- If a task is blocked or fails, note it and move to the next
  unblocked task
