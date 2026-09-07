# Shipyard Settings Tuning Guide

> **Status:** Living · **Last verified:** 2026-09-07 · **Owner:** CTO
> Rewritten for the autonomous-shipping pipeline (`docs/engineering/devops/autonomous-shipping.md`).
> Rule: a knob without an enforcement mechanism is documentation, not a setting - anything that lost its mechanism was deleted rather than kept as prose.

## Current settings

| Knob | Value | Enforced by |
|---|---|---|
| `merge-gate` | **advisory** (owner's deferral, 2026-09-07) | When flipped: GitHub ruleset on `main` - PR required, required checks = verify.yml jobs + `lens/correctness`, squash only, 0 required reviewers, admins included. Until then every check runs and reports, but direct pushes remain possible. |
| `auto-merge` | manual (agents merge on green) | Becomes GitHub auto-merge-on-green when `merge-gate` flips. |
| `spec-requirement` | `feature` | `spec-conformance` lens runs when a PR body carries a `Spec:` line; a medium+ feature PR without one gets a CONFIRMED finding. Bug fixes reference their incident instead. |
| `review` | every open PR, tiered | `com.fitsy.review-poller` LaunchAgent (every 3 min, Max subscription): correctness on medium/high tiers; + `danger-zone` on tier-high paths (`scripts/verify/risk-tiers.yml`); + `harness-audit` on the `incident` label; + `workflow-security` on CI/CD paths; + `test-quality` on test files; `docs-sanity` (comment-only) on tier-low. Statuses post as `lens/<name>`. |
| `shadow-checks` | `own-code-mocks`, `mutation`, `mobile-e2e`, `dev-drift`, `api-e2e` | `blocking: shadow` in `scripts/verify/registry.yml`; promotion = a PR flipping the field after two clean weeks. |
| `harden-on-incident` | required | `harness-audit` lens blocks incident-labeled PRs missing fix + detector + constraint + eval case + `Layer:` attribution. |
| `size-gate` | 600 changed lines | `size-check` (T8); `override-size` label escapes with written justification, logged as a Layer-10 input. |
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
| Ready for no-human-merge | Flip `merge-gate`: create the ruleset, enable auto-merge, delete the review/merge steps from `.claude/agents/sprint.md` and `~/.claude/skills/ship-branch` (they conflict once the gate exists) |
| A shadow check has been quiet two weeks | PR the registry: `blocking: shadow` -> `true` |
| A lens is noisy | Edit its `.claude/lenses/<name>.md`; `scripts/verify/evals/replay.sh` proves the edit kept recall on past incidents |
| Mutation score stuck | Surviving mutants in `.evidence/mutation/report.json` name the exact untested lines |
| An agent needs prod data | It does not; `scripts/dev/` refuses prod, `FITSY_ALLOW_PROD=1` is the deliberate exception |

Historical note: the pre-pipeline knobs (`human-review-gate: cruise`,
`wave-progression`, `active-roles`) governed the sprint-skill review loop that
the lens pipeline replaced; sprint planning conventions live in `proj-mgmt/`.
