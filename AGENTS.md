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

A Codex session is the orchestrator; use `gh` directly, with no daemon or helper script.
Use one active orchestrator session and preserve existing issue/PR ownership.

1. List all open `codex` issues oldest first, excluding pull requests:

   ```sh
   gh api --paginate 'repos/dgmolla/fitsy/issues?state=open&labels=codex&sort=created&direction=asc&per_page=100' --jq '.[] | select(.pull_request == null) | {number,title,body}'
   ```

2. For each issue number N, check both open PR references and its branch; skip an issue with an existing open PR:

   ```sh
   gh pr list --repo dgmolla/fitsy --state open --search "#N" --json number,title,url
   gh pr list --repo dgmolla/fitsy --state open --head codex/issue-N --json number,title,url
   ```

3. Take the oldest remaining issue; read its title and full body, which must contain an actionable "Done when".
   If acceptance is missing, request it on the issue and move to the next eligible task.
   A failed GitHub query is an error, not an empty queue; if no eligible issue remains after successful queries, report `queue empty` and end the session.
4. Recheck for an open PR, start from current `main`, and create branch `codex/issue-N` (replace N with the issue number).
   Read before writing, plan the small task, implement it, and run applicable checks with proof.
5. Commit, push normally with hooks enabled, and open a PR using `gh pr create --repo dgmolla/fitsy` with `Closes #N` in its body.
   Include Done-when, command/output proof, and skipped work.
6. Enable squash auto-merge with `gh pr merge --repo dgmolla/fitsy <PR_NUMBER> --auto --squash`; GitHub required checks decide whether it merges.
   Leave a PR awaiting Dawit's native-build approval unmerged and do not enable auto-merge until approval is recorded.
7. Record any failure and the next action on its issue or PR, then pick the next eligible issue.
   If the same failure happens twice, follow the lasting-fix rule in the shipping flow.

If label `codex` is missing, Dawit must create it; do not create labels or change repository settings.
See [shipping flow](docs/engineering/devops/shipping-flow.md) for the loop and simulator boundary.
