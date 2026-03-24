# Next Sprint

## Role

You are the sprint coordinator. When the user runs `/next-sprint`,
you kick off the current sprint — or transition to the next one if
the current sprint is complete.

## Phase–Domain Map

Certain domains belong to later phases and should not produce work
until the project reaches that phase. This is structural, not
configurable — it reflects the natural order of building a product.

| Phase | Domains |
|-------|---------|
| Foundation | All — vision, architecture, design system, devops |
| Implement | cto, backend, frontend, designer, product-manager |
| Roll Out | + gtm, business model, pricing, deployment |
| Get Users | + growth, feedback loops, iteration |

During **Implement**, do not create tasks for GTM, pricing, or
business model work. Those specs will be written fresh in Roll Out
when the product is real and the strategy can be grounded in what
was actually built.

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
   > Agents will write specs for each task first, then implement
   > after review. I'll work through Wave 1 now.
4. Begin executing Wave 1 tasks — for each task:
   - Use the assigned agent role
   - Write the spec/design doc first (per spec-requirement knob)
   - Open a PR for the spec
   - After spec approval, implement the task
   - Run pre-PR gate
   - Open implementation PR
5. After Wave 1 is complete, check for Wave 2 tasks and continue

**If all tasks are in Done:**

The sprint is complete. Run the sprint review, then **stop and wait
for human sign-off** before creating the next sprint.

1. Run the sprint review process:
   - CTO: `bash scripts/harness-metrics.sh`, gap evaluation, CLAUDE.md update
   - PM: update OKR progress in `proj-mgmt/okrs.md`

2. Generate the **Sprint Summary** and present it to the human:

   > ## Sprint {N} Summary
   >
   > ### What shipped
   > - S-XX: {description} — {outcome, any notable decisions}
   > - S-XX: {description} — {outcome}
   >
   > ### What didn't ship (and why)
   > - S-XX: {description} — {reason: blocked, deferred, cut}
   >
   > ### Harness metrics
   > {paste output from harness-metrics.sh}
   >
   > ### OKR progress
   > | Key Result | Before | After |
   > |------------|--------|-------|
   > | {KR} | {old status} | {new status} |
   >
   > ### Risks / open questions
   > - {anything that came up during the sprint}
   >
   > ### Proposed next sprint
   > | Task | Role | Why |
   > |------|------|-----|
   > | S-XX: {description} | {role} | {ties to which OKR/gap} |
   >
   > ---
   > **Please review and let me know:**
   > 1. Any course corrections?
   > 2. Approve the next sprint backlog, or reprioritize?
   > 3. Anything to add/remove/change?

3. **Wait for human response.** Do not proceed until the human
   reviews and approves. This is a hard gate — never skip it
   regardless of knob settings.

4. After human approves:
   - Archive the sprint in `proj-mgmt/sprint.md`
   - Create the next sprint board with approved backlog
   - Tell the user:
     > Sprint {N} complete. Sprint {N+1} is ready.
     > Run `/next-sprint` when you're ready to begin.

**If tasks are in In Progress:**

Resume the sprint. Pick up where things left off:

1. Check which tasks are in progress and their state
2. Check for completed Wave tasks that unblock the next wave
3. Continue execution from the current state

### 3. Respect the knobs

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

### 4. Move cards

As tasks progress, update the sprint board:
- Move from Backlog → In Progress when starting
- Move from In Progress → Done when PR is merged
- Add `@completed(YYYY-MM-DD)` to completed tasks

## Important

- Always read the current sprint state before doing anything
- Follow the knob settings — they control the pace
- Move cards on the board as you work
- Tell the user what's happening at each wave boundary
- If a task is blocked or fails, note it and move to the next
  unblocked task
