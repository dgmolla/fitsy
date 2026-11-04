# AGENTS.md

Fitsy is an Expo iOS app with a Next.js API on Vercel and Supabase.
Read the applicable [API](apps/api/AGENTS.md), [mobile](apps/mobile/AGENTS.md), or [shared](packages/shared/AGENTS.md) instructions before changing that package.

## Working rules

- Read existing code before writing; plan first with a small, pass/fail "Done when".
- Climb the minimalism ladder: does it need to exist; reuse repo code, platform features, standard libraries, or installed dependencies; then write the minimum code.
- One task = one branch = one PR; keep tasks small and prefer app work over process work.
- Keep task state and proof in GitHub issues and PRs, not a local process or queue.
- Reproduce bugs through the real user journey before fixing them.
- Add one small test where the risk is: branching logic, parsing, money, auth, or security; trivial changes stay trivial.
- Never skip, weaken, or bypass checks; no `--no-verify`, no admin merge, and never touch required-check configuration.
- Never print or commit secrets; use dev data only, with no production database writes or deletes.
- Use RevenueCat Test Store or sandbox only; the rate limiter must never fail open.
- TestFlight only, no App Store submission; any new native build or fingerprint change needs Dawit's OK: stop and say so in the PR.
- Never change PostHog production flags.
- Never manually edit changelogs or generated files.
- Start human-facing updates and PR bodies with `**TL;DR:**` and a short outcome sentence.
- Put each full sentence on its own line in long Markdown; use plain dashes, never em dashes.
- PR bodies must include Done-when, proof with commands and actual output, and what was skipped.
- Put new guides under the documentation domains in [docs/README.md](docs/README.md); validate their final tracked paths with the normal pre-push hook.

## Orchestrator

Use `gh` directly, with no daemon, helper script, new tooling, or skills.

### Roles

- One orchestrator session at a time; it never edits code and never merges.
  It only preflights, picks issues, starts workers, watches, and cleans up.
- One worker per issue owns it end to end until its PR merges or the issue is marked blocked.
  Preserve existing issue/PR ownership; never start a second worker for an owned issue or branch.

### Orchestrator loop

1. Preflight once at start and after any infrastructure failure: `gh auth status`, `git fetch origin`, dependencies installed with `npm ci`, Docker responding to `docker info`, and adequate disk space (`df -h`).
   On failure, comment on the pinned/tracking issue or print `PREFLIGHT FAILED: <reason>` and stop; do not start workers.
2. List open `codex` issues oldest first, excluding PRs and issues labeled `blocked`:

   ```sh
   gh api --paginate 'repos/dgmolla/fitsy/issues?state=open&labels=codex&sort=created&direction=asc&per_page=100' --jq '.[] | select(.pull_request == null and ([.labels[].name] | index("blocked") | not)) | {number,title,body}'
   ```

   A failed `gh` query is an error, not an empty queue.
   Check issue comments for unresolved `BLOCKED:` fallback notices before dispatching.
3. Run at most two workers concurrently on the 16 GB Mac.
   Only one may run Simulator/Maestro at a time; atomically acquire the shared `~/fitsy-wt/simulator.lock` with issue number and PID, and remove the owned lock on exit.
   Wait for an occupied lock; reclaim it only after verifying its owner and simulator consumers have stopped.
4. Check open PR references, the issue's linked PRs, branch, and live ownership before starting worker N:

   ```sh
   gh pr list --repo dgmolla/fitsy --state open --search "#N" --json number,title,url
   gh pr list --repo dgmolla/fitsy --state open --head codex/issue-N --json number,title,url
   git worktree add ~/fitsy-wt/issue-N -b codex/issue-N origin/main
   codex exec -C ~/fitsy-wt/issue-N -s danger-full-access -
   ```

   Fetch current `origin/main` before dispatch; if a branch/PR already exists, check out its branch instead of creating another.
   Feed stdin a prompt containing the issue number, full body, Worker rules, and Hard rules below.
   Run in the background, log to `~/fitsy-wt/logs/issue-N.log`, and record the PID and ownership on the issue.
5. Watch workers about every five minutes, not more frequently.
   When a worker exits, verify its PR: if merged, close out (the issue auto-closes), remove its worktree and local branch; if blocked, remove its worktree after preserving unfinished work on its branch.
   If it crashed without either outcome, diagnose and restart it once with the same ownership and log history; a second crash marks the issue blocked with a sanitized log tail.
6. When no eligible issues and no workers remain, sleep ten minutes and rescan; do not exit on an empty queue.
   Exit only when told to stop, except for the required preflight failure stop.

### Worker rules

- Read the issue's Goal / Done when / Proof / Constraints.
  If Done when is missing, comment asking for it, mark the issue blocked, and exit.
- Read before writing; make the smallest change meeting Done when, add one test only where real risk exists, and list what was skipped.
- Before every push, select tests for the changed files with `node scripts/verify/focused-tests.mjs --set <test paths>` and run `node scripts/verify/run.mjs --layer=0-1 --stage=cheap --scope=changed` for type-check, lint, and those tests.
  Do not push until these gates pass; local gate failures do not count as repair attempts.
  Apply this accounting prospectively; preserve previously recorded attempts.
- Run applicable repository checks locally, commit, push normally with hooks enabled, and open a PR with `Closes #N`, Done-when, command/output proof, and skipped work.
  Reuse an existing PR when present and enable `gh pr merge --repo dgmolla/fitsy <PR_NUMBER> --auto --squash`.
- When a native/Maestro run fails, reproduce and rerun only the failing journey locally until it passes, then complete one passing full native run before marking the PR ready, within the existing retry limits.
- Iterate until merged, polling the PR about every five minutes.
  If BEHIND, run `gh pr update-branch --repo dgmolla/fitsy <PR_NUMBER>`; if a required check (Verify, AI review) fails, read the logs/review, fix, and push.
  Batch all known failures into a single repair attempt where possible.
  If conflicts occur, rebase on current main and resolve them; use `--force-with-lease` if the rebase requires a rewritten push.
- Infrastructure failures (runner, simulator, network, GitHub outage) get one retry, then mark the issue blocked with the reason.
  Code/review failures get up to three fix attempts, then mark the issue blocked with a summary of what was tried.
  Keep attempt history and the next action on the issue/PR; restarting does not reset limits.
- If the same failure happens twice anywhere, add a one-line entry to `docs/engineering/devops/shipping-lessons.md` in that PR with the lasting prevention.
- Done means the PR merged; then exit.

### Hard rules (both roles)

Never merge manually, admin-bypass, weaken/skip required checks, use `--no-verify`, or change repository settings or labels except adding/removing `blocked` on issues.
Never print secrets/tokens, write production data, submit to the App Store (TestFlight only), use RevenueCat outside sandbox, make the rate limiter fail open, or run `git gc`.
Native builds (EAS build + TestFlight upload) are pre-approved by Dawit on November 2, 2026 when required to roll out a change, including an OTA fingerprint mismatch; this supersedes the earlier native-build approval rule above.
Run at most one native build/upload at a time, note it on the issue/PR, then do the OTA; never submit to App Store review.
Use `~/fitsy-wt/native-build.lock` with the same ownership and stale-lock checks as the simulator lock.
Do not delete files outside `~/fitsy-wt`.

Do not create missing labels: Dawit must create `codex`; if `blocked` is missing, use an issue comment starting with `BLOCKED:` instead and note the missing label.
Put the required TL;DR immediately after that marker and treat unresolved fallback comments as blocked until explicitly cleared on the issue.
See [shipping flow](docs/engineering/devops/shipping-flow.md) for the lifecycle and simulator boundary.
