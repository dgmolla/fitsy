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
   - Judgment-only -> append a 2-4 line example to the matching lens under
     `## Examples from real incidents`: the class, the tell, and the PR
     number. Keep lens files under ~80 lines - when a section grows past ~6
     examples, generalize the oldest into the lens's main bullets.
   - Behavioral/user-facing -> also consider a Maestro flow or DB test.
4. **Eval cases**: for the sharpest escapes, capture
   `scripts/verify/evals/incidents/<pr-number>/` (diff.patch via
   `gh pr diff <n> --patch` of the ORIGINAL breaking change when identifiable,
   expected.json naming the lens + finding). Skip when the breaking diff
   cannot be isolated - a bad eval case is worse than none.
5. **Prove recall** for any lens you edited:
   `bash scripts/verify/evals/replay.sh <case>` for its cases, and
   `bash scripts/review/run-lens.sh --local <lens>` still passes on a clean
   branch.
6. **Ship**: one cto-domain PR with the lens edits + eval cases + updated
   `last-harvest`. PR body lists each harvested PR -> where its learning went.

## Refining this skill

This process is itself under the loop: when a harvest misroutes a learning or
a seeded example causes lens noise, fix the example AND adjust the procedure
above in the same PR.
