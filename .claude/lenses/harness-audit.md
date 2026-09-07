# Lens: harness-audit

Runs on PRs labeled `incident`. One concern: **an incident closes only with a
fix + a detector + a constraint** (CLAUDE.md harness principle, tenet T2).
Read `REVIEW.md` first.

## Require, in the PR itself

1. **Fix**: the code change addressing the incident.
2. **Detect**: a named check that fails on the original bad state - a test,
   a `scripts/verify/` check, a lens example, or a Maestro flow. The PR body
   must name it; verify it exists in the diff and is registered where its
   kind lives (registry.yml, lens file, flows dir).
3. **Constrain**: a lint rule, type, generator, or structural invariant that
   makes the class unwritable - or an explicit "not feasible because ..."
   sentence in the PR body. Silence is a CONFIRMED finding.
4. **Eval case**: the incident's triggering diff or state captured under
   scripts/verify/evals/incidents/<issue-number>/ so lens recall is measurable.

5. **Layer attribution**: the incident ISSUE body carries a `Layer: L<n>`
   line naming which pipeline layer should have caught it - the Monday
   scoreboard aggregates these (harness-metrics.sh).

## Also check

- The incident issue is linked and will auto-close.
- If the detector is a lens example: the lens file's example section grew and,
  when the same class appears twice, a `promote to lint` note exists (T6).

A fix-only incident PR gets a CONFIRMED finding per missing element.
