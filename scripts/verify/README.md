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
Blocking checks are selected by layer and run context, never by changed-path filters.
Path filters apply only to advisory checks; explicit standalone checks still require `--only`.
Individual checks may limit their own work using `--scope` or report no applicable work.
A check without a registry entry, or an entry without a script, is itself a failure (tenet T11).

| Check | Layer | What it proves |
|---|---|---|
| `structural.sh` | 0 | the growing invariant checklist (`scripts/structural-tests.sh`) |
| `secrets.sh` | 0 | no hardcoded keys, committed .env, or build output in the diff |
| `lint.sh` | 1 | eslint clean across workspaces |
| `typecheck.sh` | 1 | tsc clean per workspace |
| `product-flow.sh` | 1 (local, blocking) | fresh candidate-bound simulator and affected-journey evidence; see `docs/engineering/devops/shipping.md` |
| `boundaries.sh` | 1 | imports respect the layer graph in `.dependency-cruiser.cjs` (T3) |
| `size-check.sh` | 1 | reports counted review size above or below the 600-line signal without imposing a hard cap |
| `actionlint.sh` | 1 | workflow files lint clean; actionlint and ShellCheck are required locally and in CI |
| `domain-check.sh` | 1 | reports routed domains; unavailable comparison or routing still fails |
| `context-freshness.sh` | 1 | CLAUDE.md/FEATURE_MAP commands and paths actually exist (T14) |
| `migration-safety.sh` | 1 | destructive migrations carry a down.sql (T9) |
| `test.sh` | 2 | api + scripts + mobile tests |
| `media-integration.sh` | 2 (local, blocking when simulator or product-flow controls change) | real decoder and attachment suites plus a source-bound receipt; hosted L2 stays media-tool free |
| `own-code-mocks.sh` | 2 (shadow) | api tests mock only external services |
| `build.sh` | 3 | production API build, no stray compiled output |
| `dev-drift.sh` | 3 | the dev environment has every migration on `main` and holds seed data |
| `mobile-e2e.sh` | 7 (shadow) | Retired unscoped native smoke; use required source-bound product-flow with an exact owned UDID |
| `api-e2e.sh` | 6 | a deployed API serves health + teaser-lock invariants (read-only by default; `--write` adds the register probe) |

Callers: `.githooks/pre-push` (size/domain checks plus cheap layers 0-1, changed scope), `npm run verify` (0-2), `npm run verify:all`, and `.github/workflows/verify.yml` (one thin job per layer).

The local pre-push hook runs size/domain checks, then cheap static checks and focused tests.
A fresh checkout needs installed dependencies but no issue binding, review daemon or home-directory review state.
Keep dependencies local to this checkout so workspace links resolve its own packages.
After merging schema changes, regenerate its Prisma client with `npx prisma generate --schema=prisma/schema.prisma` before verification.
GitHub requires `Verify` and `AI review` on the current PR head and owns heavy validation.
Every selected check executes on each invocation and reports its actual exit status.
An empty check selection or a missing registry script fails verification.
The L2 test check runs complete affected API, scripts and mobile groups, including files already run in the focused selection.
Unknown comparison history expands full-suite selection to every group.
An empty group selection or an engine reporting zero passing tests fails the test check.
Temporary engine reports count the current execution and are removed afterward.
The owned PostGIS target checks and migration steps still run before local database tests.

## Candidate validation order

`npm run verify -- --stage=cheap` selects the applicable canonical checks before full acceptance, including the explicit focused test selection.
Set the selection with `node scripts/verify/focused-tests.mjs --set <test paths>`.
Use optional `--jest-pattern=<test name regex>` to select focused Jest scenarios; a selection with no passing tests fails.
Focused selections run fresh before review and full acceptance.
Independent review uses [simple review](../review/simple-review.md) and the existing `AI review` gate.
The hook and verifier execute selected checks directly without a shipping session or local review gate.
Run independent review through the supported review runner before publishing.
Changes after review require review and acceptance evidence for the current source.

The registry marks product-flow as `stage: acceptance`; layers 2 and above also belong to acceptance.
The cheap stage excludes these checks.
The runner completes cheap static checks before focused tests.
API and pipeline database selections, plus selections with caller database URLs, use the owned disposable database with its target and ownership assertions.
Full local builds remain database-free and run before database acquisition.
CI runs its own required checks independently of local review state.

The saved focused recipe contains test paths and an optional Jest pattern, never a passing result.
Selected tests execute even for a documentation-only comparison; missing or empty recipes fail.
A cheap stage and a review pass each prove their own stage; full acceptance executes its affected groups afresh.
Required GitHub checks, applicable product acceptance and release approvals still apply.
