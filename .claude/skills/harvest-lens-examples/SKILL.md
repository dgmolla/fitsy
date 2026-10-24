---
name: harvest-lens-examples
description: Mine merged fix/incident PRs for escaped-bug classes and turn them into lens examples, deterministic-check candidates, and eval cases. Run after a batch of fix PRs merges, or monthly; keeps the review lenses tuned on real misses instead of imagined ones.
---

Turn shipped bug-fixes into reviewer knowledge (autoship Layer 10). Each run
is incremental: only PRs merged since the last harvest.

## State

`.claude/skills/harvest-lens-examples/last-harvest` holds the PR number the
previous run stopped at. Read it first; update it last (commit both with the
lens edits).

## Procedure

1. **Collect**: `gh pr list --state merged --limit 100 --json number,title,body,mergedAt`
   filtered to `fix(`/`revert(` titles or the `incident` label, with
   `number > last-harvest`.
   If CLI access fails, use connected tools or an authenticated browser to read the exact CI run before requesting logs from the human.
2. **Classify each PR** (read title/body; `gh pr diff <n>` when unclear).
   Answer three questions:
   - *What class of bug was this?* (one sentence, generalized past the specific file)
   - *Which layer should have caught it first?* (L0-L3 deterministic, L5 lens
     + which lens, L6/L7 e2e, L9 smoke)
   - *Was it caught pre-merge (by a check or lens) or did it escape?* Escapes
     are the valuable ones; pre-merge catches confirm coverage, note and skip.
3. **Route each escape**:
   - Deterministic-catchable (a grep, a type, a structural invariant could
     have blocked it) -> file it as a `promote to lint` candidate in the
     relevant lens AND, if cheap, write the check now (registry + script).
   - Judgment-only -> append a concise example to the matching lens under
     `## Examples from real incidents`: the class, the tell, and the PR
     number.
     Keep each lens focused on its concern and retain actionable evidence.
     Consolidate repeated examples when a shared rule preserves their failure scenarios.
   - Behavioral/user-facing -> also consider a Maestro flow or DB test.
     Inspect `npm run verify:sim-plan` and update `scripts/verify/impact-plan.mjs` plus its table-driven tests when adding affected-screen coverage.
     Keep the retained ownership router and simulator risk policy as inputs; do not restore deleted review executables.
     UI changes require local render smoke for proven screen-local style/copy, affected E2E for behavior, or full coverage for shared UI/app shells.
     Extend render checkpoints together with their maintained YAML assertions, and keep simulator execution out of pre-push.
     Keep verification-only manifest scripts and E2E orchestration out of native scope; test that dependency/build changes and `needs-sim` still force coverage.
     When changing verification caller routing, set each subprocess fixture's `FITSY_RUNS` explicitly and replay it under the L2 parent's `FITSY_RUNS=ci CI=true` environment.
     Simulator runs locally on the maintainer Mac via the sim-review poller, which posts the Simulator status; merges wait for it when scope is not none.
     CI only posts `Sim scope` and uploads `selection.json`; never restore hosted simulator execution, preflight or simulator secrets.
     Diagnose local setup through `node scripts/sim/ci.mjs --scope=changed --plan` and the shipping contract, preserving required flows and genuine billing starting states.
     Use saved Maestro YAML and Maestro MCP for new walkthroughs; validate actual interactions plus hierarchy observations through the product-flow evidence consumer when changing tool routing.
     If the canonical local media preflight cannot inspect process ownership, retain the failed result and route that check to the existing authorized host owner; do not weaken the preflight or move native execution into CI.
4. **Eval cases**: for the sharpest escapes, capture
   `scripts/verify/evals/incidents/<pr-number>/` (diff.patch via
   `gh pr diff <n> --patch` of the ORIGINAL breaking change when identifiable,
   expected.json naming the lens + finding). Skip when the breaking diff
   cannot be isolated - a bad eval case is worse than none.
5. **Prove recall** for any lens you edited: supply its captured incident diffs
   and expected findings to the independent reviewer using `REVIEW.md` and that lens.
   Record actual findings and misses with the lens change.
   Run `node --test scripts/review/simple-review.test.mjs` for routing, severity,
   complete domain coverage and independent-provider behavior.
   See `scripts/review/simple-review.md` for the supported review interface.
6. **Ship**: one cto-domain PR with the lens edits + eval cases + updated
   `last-harvest`. PR body lists each harvested PR -> where its learning went.

## Refining this skill

This process is itself under the loop: when a harvest misroutes a learning or
a seeded example causes lens noise, fix the example AND adjust the procedure
above in the same PR.
