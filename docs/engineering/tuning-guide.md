# Shipyard Settings Tuning Guide

> **Status:** Living · **Last verified:** 2026-09-07 · **Owner:** CTO
> Rewritten for the autonomous-shipping pipeline (`docs/engineering/devops/autonomous-shipping.md`).
> Rule: a knob without an enforcement mechanism is documentation, not a setting - anything that lost its mechanism was deleted rather than kept as prose.

## Current settings

| Knob | Value | Enforced by |
|---|---|---|
| `merge-gate` | existing GitHub requirements | Preserve the final `Verify` job and `AI review` gate; local cleanup does not change repository settings. |
| `auto-merge` | existing GitHub configuration | Follow the task's integration authorization and current required checks. |
| `spec-requirement` | `feature` | `spec-conformance` lens runs when a PR body carries a `Spec:` line; a medium+ feature PR without one gets a CONFIRMED finding. Bug fixes reference their incident instead. |
| `review` | one independent review per candidate | `scripts/review/simple-review.mjs` uses the retained router and severity rules; only CONFIRMED P0/P1 findings block. The installed local reviewer supplies `AI review`. |
| `shadow-checks` | `own-code-mocks`, `mutation`, `dev-drift`, `api-e2e` | `blocking: shadow` in `scripts/verify/registry.yml`; promotion = a PR flipping the field after two clean weeks. |
| `UI smoke` | required in CI for mobile/web UI | `impact-plan.mjs` selects render smoke for proven screen-local style/copy, affected E2E for behavior, and full coverage for shared UI/app shells; `mobile-e2e` fails Build without changing final Verify or pre-push semantics. |
| `harden-on-incident` | required | `harness-audit` lens blocks incident-labeled PRs missing fix + detector + constraint + eval case + `Layer:` attribution. |
| `size-gate` | 600 changed lines | `size-check` reports a review-size signal; scope is judged by coherent outcome and acceptance rather than a hard line cap. |
| `mutation-break` | 50 (baseline 59.0%, 2026-09-07) | `stryker.config.mjs` `thresholds.break`; ratchet +5/month while green (rollout step 10). |
| `human-override` | `override-check` label | Logged and reviewed on the Monday scoreboard. |

## The one command

`npm run verify` (layers 0-2, changed scope) is the whole pre-PR gate; the
pre-push hook runs it plus size and domain checks on every push. The check
list itself lives in `scripts/verify/registry.yml` - change behavior there,
not here.

## Tighten vs. loosen

| Situation | Change |
|---|---|
| Merge requirements need adjustment | Treat it as a separately authorized repository-settings change; tooling cleanup preserves existing gates. |
| A shadow check has been quiet two weeks | PR the registry: `blocking: shadow` -> `true` |
| A lens is noisy | Edit its `.claude/lenses/<name>.md`, compare independent findings against captured incident examples, and run `node --test scripts/review/simple-review.test.mjs` |
| Mutation score stuck | Surviving mutants in `.evidence/mutation/report.json` name the exact untested lines |
| An agent needs prod data | It does not; `scripts/dev/` refuses prod, `FITSY_ALLOW_PROD=1` is the deliberate exception |

Historical note: the pre-pipeline knobs (`human-review-gate: cruise`,
`wave-progression`, `active-roles`) governed the sprint-skill review loop that
the lens pipeline replaced; sprint planning conventions live in `proj-mgmt/`.
