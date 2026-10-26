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
| `structural.sh` | 0 | the growing invariant checklist (`scripts/structural-tests.sh`); loopback literals require `// loopback test fixture` in `.test.ts`/`.test.tsx`, while private-network literals remain blocked |
| `secrets.sh` | 0 | no hardcoded keys, committed .env, or build output in the diff |
| `lint.sh` | 1 | eslint clean across workspaces |
| `typecheck.sh` | 1 | workspace type-check scripts pass; API generates the current Prisma client before tsc |
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
| `api-e2e.sh` | 6 | a deployed API serves health + teaser-lock invariants (read-only by default; `--write` adds the register probe) |

Callers: `.githooks/pre-push` (size/domain checks plus cheap layers 0-1, changed scope), `npm run verify` (0-2), `npm run verify:all`, and `.github/workflows/verify.yml` (one thin job per layer).

## Diagnostic logs

Every `run.mjs` invocation writes complete per-check stdout and stderr to a fresh `.evidence/verify/logs/run-*/` directory.
Each executed check's JSON result includes `logs.stdout` and `logs.stderr` paths relative to the checkout.
Child processes write directly to these files without an output buffer limit.
Passing, failing, shadow-failing and skipped checks all retain their output, and rerunning Verify preserves prior logs.
Failed checks print the last 10,000 bytes of each stream and the full log paths, followed by the concise failure summary.
The `test` check names every failing workspace or test engine even when later suites pass.
Use the retained stderr log to recover an early API assertion hidden by later mobile output.

Verify's Static, Tests and Build jobs upload only `.evidence/verify/logs/` with `always()`, including hidden directories, even after a check fails.
Artifacts are named `verify-l0-l1-logs-attempt-N`, `verify-l2-logs-attempt-N` and `verify-l3-logs-attempt-N`, with seven-day retention and separate names for retries.
An earlier setup failure may leave no logs; the upload warns without changing the check's failure.
The final Verify job keeps its existing success and legitimate-skip requirements.
Engine reports used to count passing test cases remain temporary.

Replay the real failing-API-then-passing-mobile regression and output retention checks with:

```sh
npm test -w @fitsy/scripts -- --runInBand --runTestsByPath verify/focused-tests.test.ts verify/run-output.test.ts
```

## Simulator coverage

`npm run verify:sim-plan` prints the simulator scope, reason and exact existing Maestro flow names.
Use `npm run verify:sim-plan -- --release-candidate` for explicit release planning; release events and tag refs also require the full flow set.
`impact-plan.mjs` consumes the retained `route-reviewers.sh` ownership routing and `risk-tiers.yml` path policy, then maps mobile paths to flows.
The retired review tier executable is not required; `REVIEW.md` severity rules and independent review remain separate.
Docs, tests, scripts and changes without mobile consumers select `none`; mapped mobile and API behavior selects `flow`; navigation, auth, billing, native configuration, release and unknown mobile-facing impact select `full`.
Each omitted flow has a reason in the plan, including the hosted `selection.json` artifact.
`npm run verify:product-plan` uses the same mapping for mandatory final journeys and MCP categories.
The final runner executes the selected complete YAML journeys and adds explicit diagnostics without appending unrelated baselines.
Acceptance rejects an omitted selected flow or a truncated command report, as well as failed or skipped required assertions.
Manifest edits confined to verification scripts are verification tooling, so they do not request a simulator.
Dependency, lifecycle/build script and other manifest changes retain their normal risk; unreadable manifest comparisons cannot narrow coverage.
Every mobile or web UI source change requires simulator/E2E coverage.
Proven literal copy or StyleSheet value edits on mapped screens select `scope: smoke` and `mode: render`, using the maintained journey's setup through the screen's render assertion and a screenshot.
Changed navigation, state, forms, new/deleted screens and uncertain syntax retain affected E2E flows.
Shared components, theme/assets, app shells and unmapped UI require the full suite.
Mixed changes keep the broader coverage; render smoke never narrows high risk.
The exact `needs-sim` PR label forces execution, using the affected selection when available and the full set otherwise.
Unavailable history or classification expands to full coverage.
Adding or removing that label reruns Verify.

The existing Build job runs only L3 checks on Ubuntu.
CI computes `none|smoke|flow|full`, exports flow names and render checkpoints, and uploads the full plan as `selection.json` in the `sim-scope` artifact.
The classifier and its baseline scripts have read-only credentials, with checkout credential persistence disabled.
The separate `sim-scope.yml` completion workflow loads its publisher from the protected workflow revision, validates the source run, artifact and current PR head, and posts `Sim scope` with `scope=<scope> flows=<count>`.
Only that trusted publisher has `statuses: write`; it never executes candidate code.
The local poller reads exact flow names and render checkpoints from the linked Verify run's `selection.json`, rather than parsing names from the bounded status description.
A docs-only `needs-sim` label requests local flows while static, tests and Build remain skipped.
The final Verify aggregator is unchanged.
Simulator runs locally on the maintainer Mac via the sim-review poller, which posts the Simulator status; merges wait for it when scope is not none.
Run the local scripted gate with `node scripts/sim/ci.mjs --scope=<scope> --flows=<comma-list> --udid=<UDID>` after loading the Mac's dev environment and preparing its candidate build.
Use `--plan` to inspect explicit scope and flows without launching native tools; `--scope=changed` consumes the shared impact plan.
Keep render checkpoints and the comparison range aligned with the selected PR head.
Account-dependent journeys declare `fixture:` and `store:` tags in their maintained YAML.
Load `FITSY_E2E_FIXTURES` with local, untracked preparation commands and per-fixture public environments as described in [the native README](../../apps/mobile/e2e/README.md#local-journey-fixtures).
The runner resolves every required fixture before native execution, prepares it before each journey, validates the installed build/store and restarts owned Metro for that fixture's configuration.
It preserves the entire selected flow set and fails when genuine purchase history or the required store build is unavailable.
Explicit scopes may expand the plan, but cannot omit its journeys or replace behavior coverage with render smoke.
Use an existing compatible binary or a supported build with measured capacity; a shared binary cache is optional.
The ordinary native build command checks the [shared immutable cache](../../docs/engineering/devops/native-binary-reuse.md#shared-native-cache) after local receipts; its regression suite runs through the scripts workspace's Node bridge in the existing test check.
Retire owned Metro, drivers and simulator resources at the end of the phase through the existing lifecycle controls.
CI execution is refused by the local runner, and the registry contains no native execution check.
Replay scope regressions with `npm test -w @fitsy/scripts -- --runInBand --runTestsByPath verify/simulator-scope.test.ts sim/ci.test.ts`.
Replay trusted publication and fixture isolation with `node --test scripts/verify/sim-scope-status.test.mjs scripts/sim/journey-fixtures.test.mjs`.
See [shipping.md](../../docs/engineering/devops/shipping.md) for native setup, billing starting states and separate source-bound product acceptance.

The local pre-push hook runs size/domain checks, then cheap static checks and focused tests.
UI smoke executes locally on the Mac, with no simulator step added to this hook.
A fresh checkout needs installed dependencies but no issue binding, review daemon or home-directory review state.
Keep dependencies local to this checkout so workspace links resolve its own packages.
Type checking calls each workspace's `npm run type-check`, including Prisma generation from the repository schema before compiling the API.
This refreshes stale generated types after schema updates without requiring a database connection or migration.
The scripts TypeScript project maps `@fitsy/shared` imports to this checkout's source even when a workspace package link is unavailable.
The scripts Jest configuration maps the same shared package and subpaths to local source so tests use the current checkout too.
To refresh the client separately after merging schema changes, run `npx prisma generate --schema=prisma/schema.prisma`.
GitHub requires `Verify` and `AI review` on the current PR head and owns heavy validation.
Every selected check executes on each invocation and reports its actual exit status.
An empty check selection or a missing registry script fails verification.
The L2 test check runs complete affected API, scripts and mobile groups, including files already run in the focused selection.
Unknown comparison history expands full-suite selection to every group.
An empty group selection or an engine reporting zero passing tests fails the test check.
Temporary engine reports count the current execution and are removed afterward.
Local and hosted L2 checks use the same worktree-owned PostGIS launcher, including its OS lock, inspected container identity, loopback target checks, migrations and data-only seed.
The canonical runner creates that disposable database before database-dependent checks; the hosted job does not provision a separate service container.
An unowned target or caller-supplied ownership markers cannot replace the inspected database assertion.

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
Full builds remain database-free and run before database acquisition.
CI runs its own required checks independently of local review state.

The saved focused recipe contains test paths and an optional Jest pattern, never a passing result.
Selected tests execute even for a documentation-only comparison; missing or empty recipes fail.
A cheap stage and a review pass each prove their own stage; full acceptance executes its affected groups afresh.
Required GitHub checks, applicable product acceptance and release approvals still apply.
