# scripts/verify

One script per check.
CI, the local pre-push hook, and agents all call the same scripts; nothing is implemented twice.
Design: `docs/engineering/devops/autonomous-shipping.md` §3.

## Check contract

```
scripts/verify/<name>.sh [--scope=changed|all]
exit 0 = pass, 1 = fail, 2 = skipped (not applicable here)
stdout: one JSON line {"name","status","summary","fix"}
stderr: human-readable detail
```

`fix` is mandatory on failure: what a context-free author should run or change.

## Registry

`registry.yml` lists every check with its layer, tier, path filters, blocking mode, and the reason it exists.
Blocking checks are selected by layer and run context, never by changed-path filters. Path filters apply only to advisory checks; explicit standalone checks still require `--only`. Individual checks may limit their own work using `--scope` or report no applicable work.
A check without a registry entry, or an entry without a script, is itself a failure (tenet T11).

| Check | Layer | What it proves |
|---|---|---|
| `structural.sh` | 0 | the growing invariant checklist (`scripts/structural-tests.sh`) |
| `secrets.sh` | 0 | no hardcoded keys, committed .env, or build output in the diff |
| `lint.sh` | 1 | eslint clean across workspaces |
| `typecheck.sh` | 1 | tsc clean per workspace |
| `product-flow.sh` | 1 (local, blocking) | fresh candidate-bound simulator and affected-journey evidence; see `docs/engineering/devops/shipping.md` |
| `boundaries.sh` | 1 | imports respect the layer graph in `.dependency-cruiser.cjs` (T3) |
| `size-check.sh` | 1 | the PR is under 600 changed lines, or carries `override-size` (T8) |
| `actionlint.sh` | 1 | workflow files lint clean; CI requires pinned actionlint and ShellCheck |
| `domain-check.sh` | 1 | the PR touches a single domain |
| `context-freshness.sh` | 1 | CLAUDE.md/FEATURE_MAP commands and paths actually exist (T14) |
| `migration-safety.sh` | 1 | destructive migrations carry a down.sql (T9) |
| `test.sh` | 2 | api + scripts + mobile tests |
| `own-code-mocks.sh` | 2 (shadow) | api tests mock only external services |
| `build.sh` | 3 | production API build, no stray compiled output |
| `dev-drift.sh` | 3 | the dev environment has every migration on `main` and holds seed data |
| `mobile-e2e.sh` | 7 (shadow) | Maestro flows pass on the simulator |
| `api-e2e.sh` | 6 | a deployed API serves health + teaser-lock invariants (read-only by default; `--write` adds the register probe) |

Callers: `.githooks/pre-push` (layers 0-2, changed scope), `npm run verify` (0-2), `npm run verify:all`, and `.github/workflows/verify.yml` (one thin job per layer).
