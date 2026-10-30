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
| `structural.sh` | 0 | the growing invariant checklist (`scripts/structural-tests.sh`); local diff checks include tracked edits before commit, while CI checks committed source; loopback literals require `// loopback test fixture` in `.test.ts`/`.test.tsx`, while private-network literals remain blocked |
| `secrets.sh` | 0 | no hardcoded keys, committed .env, or build output in the diff |
| `lint.sh` | 1 | eslint clean across workspaces |
| `typecheck.sh` | 1 | workspace type-check scripts pass; API generates the current Prisma client before tsc |
| `performance.sh` | 1 | no routed prototypes or resolved runtime preload/LLM dependencies |
| `product-flow.sh` | 1 (local, blocking) | fresh candidate-bound simulator and affected-journey evidence; see `docs/engineering/devops/shipping.md` |
| `boundaries.sh` | 1 | imports respect the layer graph in `.dependency-cruiser.cjs` (T3) |
| `size-check.sh` | 1 | reports counted review size above or below the 600-line signal without imposing a hard cap |
| `actionlint.sh` | 1 | workflow files lint clean; actionlint and ShellCheck are required locally and in CI |
| `domain-check.sh` | 1 | reports routed domains; unavailable comparison or routing still fails |
| `context-freshness.sh` | 1 | CLAUDE.md/FEATURE_MAP commands and paths actually exist (T14) |
| `migration-safety.sh` | 1 | destructive migrations carry a down.sql (T9) |
| `test.sh` | 2 | api + scripts + mobile tests, including Python cleanup and loop recovery regressions |
| `rate-limit-store.sh` | 2 | actual Redis Lua and independent API workers enforce shared quotas, trusted-IP selection, atomic admission and key bounds; requires Docker |
| `media-integration.sh` | 2 (local, blocking when simulator, product-flow or loop host controls change) | real decoder, attachment and credential-isolation suites plus a source-bound receipt; hosted L2 stays media-tool free |
| `own-code-mocks.sh` | 2 (shadow) | api tests mock only external services |
| `build.sh` | 3 | offline production API compilation, no stray compiled output; actual store bindings are checked by the guarded Vercel build preflight |
| `mobile-bundle.sh` | 3 | production iOS minified JS and gzip budgets; offline local export only |
| `dev-drift.sh` | 3 | the dev environment has every migration on `main` and holds seed data |
| `api-e2e.sh` | 6 | a deployed API serves health + missing/invalid-session 401s + authenticated entitlement locks; healthy-DB/invalid-session 503 failures direct shared-store readiness inspection (read-only by default; `--write` adds registration only on the exact dev origin or loopback HTTP) |

Callers: `.githooks/pre-push` (size/domain checks plus cheap layers 0-1, changed scope), `npm run verify` (0-2), `npm run verify:all`, and `.github/workflows/verify.yml` (one thin job per layer).

Performance commands, measured baselines, native profiling and dev request sampling are documented in [the performance runbook](../../docs/engineering/devops/performance.md).
The scripts test group includes `scripts/perf/*.test.mjs`; mobile tests include the search card-render budget.
No network latency or native frame-time threshold runs in the ordinary loop.

## Diagnostic logs

Every `run.mjs` invocation writes complete per-check stdout and stderr to a fresh `.evidence/verify/logs/run-*/` directory.
Each executed check's JSON result includes `logs.stdout` and `logs.stderr` paths relative to the checkout.
Child processes write directly to these files without an output buffer limit.
Passing, failing, shadow-failing and skipped checks all retain their output, and rerunning Verify preserves prior logs.
Failed checks print the last 10,000 bytes of each stream and the full log paths, followed by the concise failure summary.
The `test` check names every failing workspace or test engine even when later suites pass.
Use the retained stderr log to recover an early API assertion hidden by later mobile output.
If a sandbox cannot reach GitHub through `gh`, read the run and download its complete diagnostic artifact through the authenticated browser, then match the archive's SHA-256 to the digest displayed by GitHub before inspecting it locally.
If the browser's download event times out, check its configured download directory for a completed archive before retrying; the file can arrive without an event being reported.
Require the same SHA-256 match before using that file.

Verify's Static, Tests and Build jobs upload only `.evidence/verify/logs/` with `always()`, including hidden directories, even after a check fails.
Artifacts are named `verify-l0-l1-logs-attempt-N`, `verify-l2-logs-attempt-N` and `verify-l3-logs-attempt-N`, with seven-day retention and separate names for retries.
An earlier setup failure may leave no logs; the upload warns without changing the check's failure.
The final Verify job keeps its existing success and legitimate-skip requirements.
Engine reports used to count passing test cases remain temporary.

Replay the real failing-API-then-passing-mobile regression and output retention checks with:

```sh
npm test -w @fitsy/scripts -- --runInBand --runTestsByPath verify/focused-tests.test.ts verify/run-output.test.ts
```

## Live dependency audit evidence

Run `npm run verify:dependencies` from a worker with access to the public npm registry.
This explicit evidence collector runs full and production lockfile audits for all workspaces against the live advisory service, including optional and peer dependencies.
It does not install packages or change the lockfile.
Ordinary Verify and the pre-push hook remain offline-capable; this command is separate from registry checks.

Each invocation retains the original JSON and stderr from both scans, the exact lockfile, its SHA-256, source SHA, Node/npm versions, commands, timing and exit statuses in a fresh `.evidence/dependency-audit/` directory.
Exit 0 means both scans completed without findings; exit 1 means complete reports contain findings requiring applicability review; exit 2 means coverage is incomplete.
Registry errors, malformed or partial reports, inconsistent counts, abnormal exits and lockfile drift cannot establish a complete audit.
The production scan still runs if the full scan fails.

Retain the complete reports with the originating security issue, such as [#562](https://github.com/dgmolla/fitsy/issues/562), rather than only the vulnerability counts.
For every finding, record the advisory, exact installed/locked version, workspace and dependency chain, runtime or tooling caller, attacker-controlled input, deployment conditions, P0-P3 app impact and supporting evidence.
Repair confirmed P0/P1 findings and retain lower-priority findings and unresolved applicability in linked issues.
Vendor severity alone does not establish reachable app impact.

If registry access is denied, preserve the incomplete run and resume this command through the existing network-enabled execution owner.
An offline installation or cached metadata cannot replace a live advisory scan.
Upgrade packages with supported npm commands and regenerate the lockfile through npm; never hand-edit versions or integrity fields.
After an upgrade, run `npm ci`, applicable tests, lint/types, production build and affected app smoke before claiming completion.

Replay the audit capture regressions with:

```sh
npm test -w @fitsy/scripts -- --runInBand --runTestsByPath verify/dependency-audit.test.ts
```

## OTA vs native build

For mobile release verification, use `node scripts/deploy/native-compatibility.mjs` after installing the frozen lockfile.
It compares Expo's iOS native fingerprint with a verified binary receipt, then repeats with the production environment before OTA export.
JS, styles and bundle-only assets use OTA when the fingerprint and runtime match.
Native modules, permissions, plugins, icon/splash, Expo SDK and widget/Swift changes require a new binary.
Missing binary fingerprints, incomplete collection, changed native configuration and incompatible runtimes block publication.
Follow [the OTA baseline runbook](../../docs/engineering/devops/ios-ota-baseline.md) for build evidence, the TestFlight channel cutover and Dawit's manual App Store production approval.
These release checks do not change the affected Maestro journey requirements below.

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
Optional `--record-video` or `FITSY_SIM_RECORD_VIDEO=1` records a bounded Slack preview beside each journey's screenshots; recording failures are non-fatal.
The [runner controls](../sim/native-runner-controls.md#optional-slack-previews) document size and timing bounds, the external Mac poller wrapper and the existing Slack discovery path.
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
Replay scope and preview regressions with `npm test -w @fitsy/scripts -- --runInBand --runTestsByPath verify/simulator-scope.test.ts sim/ci.test.ts sim/slack-video.test.ts`.
Replay trusted publication and fixture isolation with `node --test scripts/verify/sim-scope-status.test.mjs scripts/sim/journey-fixtures.test.mjs`.
See [shipping.md](../../docs/engineering/devops/shipping.md) for native setup, billing starting states and separate source-bound product acceptance.

The local pre-push hook runs size/domain checks, then cheap static checks and focused tests.
UI smoke executes locally on the Mac, with no simulator step added to this hook.
A fresh checkout needs installed dependencies but no issue binding, review daemon or home-directory review state.
Keep dependencies local to this checkout so workspace links resolve its own packages.
When the dependency preflight reports `verification dependencies are missing`, run `npm ci` in that checkout before rerunning the unchanged verifier or hook.
The preflight checks every workspace's direct runtime and development dependencies from the lockfile, including nested mobile packages, and identifies missing packages before running checks.
When restoring an identical-lockfile dependency tree from another checkout, include each workspace's `node_modules` as well as the root directory.
Copying only the root directory can omit `expo-blur`, `react-native-reanimated` and `@testing-library/react-native`, producing missing-module and cascading implicit-any errors.
If network access is unavailable but an existing npm cache contains the lockfile's packages, copy that cache to a writable task-owned directory and run `npm ci --offline --cache <task-cache>`.
Keep the lockfile and hook unchanged; a cache miss still requires restoring the missing package through supported access.
In a sandbox where Prisma cannot update its home cache, copy the existing Prisma cache into `<task-cache>/prisma` and set `XDG_CACHE_HOME=<task-cache>` for the normal verification command.
Prisma consumes this supported cache location while retaining its normal generation and engine checks.
Type checking calls each workspace's `npm run type-check`, including Prisma generation from the repository schema before compiling the API.
This refreshes stale generated types after schema updates without requiring a database connection or migration.
The scripts TypeScript project maps `@fitsy/shared` imports to this checkout's source even when a workspace package link is unavailable.
The scripts Jest configuration maps the same shared package and subpaths to local source so tests use the current checkout too.
To refresh the client separately after merging schema changes, run `npx prisma generate --schema=prisma/schema.prisma`.
GitHub requires `Verify` and `AI review` on the current PR head and owns heavy validation.
Every selected check executes on each invocation and reports its actual exit status.
An empty check selection or a missing registry script fails verification.
The L2 test check runs complete affected API, scripts and mobile groups, including files already run in the focused selection.
It also runs `npm test -w packages/shared` for pure contracts on every selection.
Shared matching and macro tests can be selected directly with `focused-tests.mjs --set packages/shared/src/utils/macroScoring.test.ts`.
Each app and shared package documents its single test command in its own `AGENTS.md`; API test commands generate the current Prisma client first.
Unknown comparison history expands full-suite selection to every group.
An empty group selection or an engine reporting zero passing tests fails the test check.
Temporary engine reports count the current execution and are removed afterward.
Local and hosted L2 checks use the same worktree-owned PostGIS launcher, including its OS lock, inspected container identity, loopback target checks, migrations and data-only seed.
The canonical runner creates that disposable database before database-dependent checks; the hosted job does not provision a separate service container.
An unowned target or caller-supplied ownership markers cannot replace the inspected database assertion.
The database cluster and WAL use `PGDATA=/var/lib/postgresql/verify-data` in the disposable container's disk layer, so growing database files do not consume the container's RAM allowance as tmpfs data.
A separate 1 MiB tmpfs covers the image's unused `/var/lib/postgresql/data` volume declaration to avoid leaving anonymous volumes.
The existing memory, swap, CPU, disk, ownership and database target protections remain in place.
Under the same exclusive lock, the launcher replaces an owned container from the old RAM-backed layout before readiness or database writes, rechecking its acquired ID and image before removal.
After the verification pipeline returns or throws, the launcher retires the acquired container under the same lock, checking its owner, immutable ID and image again.
This also applies when a run acquires a previously existing owned container, since each run resets and reseeds its database.
Preparation failures after acquisition retire that same checked identity, including a failed migration or seed.
Database-free verification does not acquire or retire a container.
If PostgreSQL readiness fails, the launcher checks the acquired container for an OOM kill before cleanup and preserves the original readiness failure in its diagnostic.
Release confirmed unused Docker compute through the existing cleanup owner before retrying an OOM failure; keep container limits and database target protections unchanged.
Replay launcher lifecycle and ownership regressions with `npm test -w @fitsy/scripts -- --runInBand --runTestsByPath verify/local-db.test.ts verify/run-db-order.test.ts`.

API and pipeline Jest configurations also run `scripts/lib/test-database-guard.ts` before importing any test suite.
This covers direct workspace `npm test`, coverage and Jest invocations as well as hooks and hosted verification.
Both `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING`, when configured, must identify loopback PostgreSQL without a Supabase project route.
Production, shared DEV, unknown remote hosts, encoded project routes and unsupported routing parameters abort with `DB_TEST_REFUSED` without printing credentials.
Production write flags, `NODE_ENV=test` and fixture environment markers cannot override this rule.
Without either URL, existing database suites remain skipped and unit suites run normally.
External Supabase SDK fixtures must use a loopback Auth origin when inheriting the disposable database URLs, so the real DB/Auth project guard runs before the substituted provider transport.
Keep a loopback database URL in direct client-construction fixtures even during database-free unit runs to catch incompatible Auth origins locally.
Use `npm run verify -- --only=test` to provision, migrate and seed the existing worktree-owned disposable database.
For a direct DB-suite invocation, supply an already migrated and seeded disposable local database, then run `npm test -w apps/api -- tests/db --runInBand`.
The synthetic goal-preview benchmark uses the same target guard and retains its stricter localhost requirement.
The separate read-only `perf:db` diagnostic intentionally retains its DEV-only target contract.
API Jest configuration is verification tooling in both simulator and product impact plans; runtime API configuration retains its normal journey coverage.

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
The recipe is local to each checkout in `.evidence/verify/focused-tests.json` and is not committed.
If a fresh checkout or pre-push run reports a missing, empty or malformed selection, use `--set` with the issue's meaningful regressions, then rerun `npm run verify -- --stage=cheap`.
The canonical runner's selection takes precedence over the saved file, including an empty selection; it cannot fall back to stale tests.
A cheap stage and a review pass each prove their own stage; full acceptance executes its affected groups afresh.
Required GitHub checks, applicable product acceptance and release approvals still apply.
