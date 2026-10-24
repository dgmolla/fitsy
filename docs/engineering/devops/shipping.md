# Shipping a Fitsy change

The human-selected standalone Pstack `orchestrate-delivery`, `ship-branch` and `verify-fitsy` skills control coordination, evidence planning and shipping sequence.
Load the exact committed package paths supplied in the coordinator assignment.
Latest direct human instructions and issue-bound authorizations take precedence.
This document supplies supported command contracts, product acceptance, security/data protections and release requirements.
It does not impose another workflow, lifetime review count, automatic retry or budget increase.
The executable checks remain in `scripts/verify/registry.yml`, `scripts/verify/risk-tiers.yml`, and `scripts/review/`.
Historical recipes in `autonomous-shipping.md` and generic global skills do not select a competing pipeline.

```mermaid
flowchart LR
    A[Implement and freeze candidate] --> B[Cheap canonical checks and focused regressions]
    B --> C[One source-bound independent review]
    C -->|Repair findings| A
    C -->|Pass| D[Reviewed cheap-plus-focused publication]
    D --> T[Trusted exact-tree Verify plus applicable media/native acceptance]
    T --> E[Protected authorized merge and deploy]
    E --> F[Main Verify plus Deploy plus product smoke]
```

## One branch owner and one review process

Inspect active worktrees and compare changes against each branch's merge base before integrating overlapping work.
Do not change another agent's checkout or force-push its branch.
Keep dependency chains explicit and rebase the dependent branch after its prerequisite lands.
Define one accepted user outcome per PR, with acceptance evidence, non-goals, and one execution owner.
An API and mobile change may ship in one PR when their contract evolves together; split only independently useful and safe outcomes.
Distinguish actual blockers from preferred order, and verify a backward-compatible interface with a small end-to-end contract check before shipping an API-first sequence.
The domain and 600-line checks report scope for review; neither imposes an automatic split or replaces affected product and security gates.
Use a fresh checkout for integration/deployment when the primary checkout is occupied.
Do not use a feature-branch mobile publication as a substitute for integrating the intended release commit.

Freeze the accepted outcome and non-goals when validation starts.
Optional hardening and preferred abstractions remain owned follow-ups unless a reachable failure invalidates required acceptance.
A substantive new human requirement changes scope explicitly; acknowledge it and refreeze the candidate before continuing.
Finish implementation and commit the frozen candidate before review.
Select meaningful focused reproduction and regression tests for the changed behavior.
Run applicable structural, lint, type and safety checks plus that focused selection before independent review.
Local admission completes cheap checks and revalidates matching independent evidence through immutable trusted-main reviewer controls.
Reviewer execution is a separate explicit operation under the original issue accounting.

```sh
node scripts/verify/focused-tests.mjs --set scripts/verify/impact-plan.test.ts
npm run verify -- --stage=cheap
export FITSY_REVIEW_PROVIDER=codex
export FITSY_REVIEW_MODEL=gpt-6-sol
export FITSY_REVIEW_REASONING_EFFORT=high
# Execute only the independently authorized review of the frozen candidate.
/bin/bash -p scripts/verify/review-admission.sh --execute-review
# Revalidate that evidence and own ordinary pre-push publication live.
scripts/verify/shipping-session.mjs -- bash <task-owned-shipping-script>
```

Replace the focused test and task script with the accepted issue's meaningful regressions and applicable final acceptance commands.
Focused selection supports Jest, Node `.test.mjs` and Python `.test.py` through the canonical runner.
The task script must stop on failed cheap checks or matching review before push; applicable final acceptance remains mandatory before protected merge.
A focused selection is not full acceptance; correctness review still judges scenario relevance.

Admission checks out the frozen candidate in a disposable directory and restores immutable reviewer controls from the managed external review repository main.
Default admission uses `run-review.sh --local --cached-only` and cannot execute a provider when matching evidence is missing.
Explicit `--execute-review` uses the same authenticated overlay, ignores cached results and charges the original issue ledger.
The existing canonical review cache must remain outside every Git checkout; candidate-local caches cannot admit shipping.
Cached verdicts require a retained matching provider execution, source/base/key binding, the result digest recorded by trusted closeout, and unchanged original raw artifacts.
Bare or legacy unproven cache JSON cannot admit shipping.
Externally authorized original completed evidence remains subject to the source, base, issue, acceptance, provider, domain and raw-artifact checks.
No candidate controls are installed as trusted, and no new persisted admission or saved-pass projection is created.
Changing material review inputs invalidates reuse.

The live shipping session binds committed head, base, clean checkout, delivery issue, authorization and focused selection through acceptance and push.
Closing it removes execution ownership; a later session revalidates matching evidence without demanding another reviewer.
Final-candidate simulator acceptance requires that live ownership.
Source drift invalidates the session and requires affected evidence to be revalidated before shipping.
Raw admission attempts remain under `.evidence/review-admission/`.
`--stage=cheap` cannot satisfy final acceptance.
Hosted checks retain their independent required suites.
Apple/legal approvals, product-flow status, hooks, PR checks, main Verify, Deploy and actual affected release proof remain required.

Keep source frozen throughout checks, review and acceptance.
Later source changes require current cheap checks, review and affected full acceptance.
Every selected verification check executes afresh, and full affected test groups include the focused test files.
Empty selections, missing scripts and zero passing test cases fail verification.
Review-budget attempts and raw failure history never reset.
UI signoff and development walkthroughs precede final UI acceptance.
The publishable `final-candidate` simulator entry point requires the live shipping session's matching canonical review before native journeys.
Keep each publishable native journey and its finish inside live matching-review ownership, using `set -e` or `&&` to stop on failure.
For ordinary publication, run `scripts/verify/shipping-session.mjs -- git push -u origin HEAD` after freezing and reviewing the candidate.
The existing trusted public Verify supplies heavy validation before protected merge; applicable local media/native evidence may be completed separately against that same frozen head.
Development walkthroughs and UI signoff happen before that session.
Source or focused-selection drift invalidates the live admission and requires revalidation of cheap checks and affected review evidence; it never silently starts another reviewer.
Apple account, legal and submission approvals, required product-flow status, pre-push, PR, main Verify, Deploy and actual release acceptance remain required.

The pre-push hook revalidates the live source-bound independent review, runs cheap/focused checks plus size/domain checks, then rechecks live ownership.
It does not run local tests/builds as a publication prerequisite.
The independently installed external approval operator validates the existing Verify workflow bytes, approved candidate tree, PR base/head/merge tree, exact run/attempt/checksuite and successful standard-runner jobs from the GitHub Actions issuer before publishing required acceptance.
The existing per-issue `local_acceptance` policy pins `source_tree_sha` from the independently reviewed candidate and retains only the applicable local receipt/recipe/required checks, including real media when affected.
An empty local required-check set means no applicable local receipt, not permission to skip trusted CI or product-flow/release protections.
A hook pass does not replace the applicable product-flow verification or independent review.
The registry determines which checks apply and whether a check is blocking or shadow.
Removing obsolete structural exceptions belongs to the changed product domain only when every removed entry names a file in the same diff.
Allowlist additions, unrelated removals, deletion of the allowlist and unreadable history retain infrastructure ownership.

Changes under `scripts/sim/` or the product-flow verification controls run the blocking local `media-integration` lane in `npm run verify`.
Install `ffprobe` and `ffmpeg` locally before that run.
The lane runs real decoder, XCTest attachment and opt-in recorder cases, then records `.evidence/verify/media-integration.json` with the candidate SHA and source/test hash.
Hosted L2 runs deterministic tests without media tools.
After committing, rerun `node scripts/verify/run.mjs --only=media-integration --runs=local` so the receipt names the PR head.
The `product-flow/local` publisher checks that receipt before setting its exact-head status, including when mobile product evidence is not applicable.

**Local product-flow gate.** Local iPhone E2E is blocking for mobile-facing changes.
CI runs static checks, unit tests and builds; its optional simulator workflow remains experimental.
Applicable product acceptance and its exact-head publisher require fresh `.evidence/product-flow/report.json` when impact selection applies; ordinary publication does not claim that proof.
Missing tools, skipped/failed assertions, missing coverage and stale evidence fail; unrelated changes get explicit `not_applicable`.

Use an owned worktree, `npm run dev:env`, and an explicit simulator UDID.
Keep public configuration in the ignored mobile environment file.
The builder generates an embedded Release app, disables downloaded OTA updates, and records source/native/JS/configuration identities.
A keyless build proves navigation only and cannot cover billing.
Never publish credentials or personal data in evidence.

For RevenueCat Test Store, add `--test-store` to `build` and configure the public `EXPO_PUBLIC_REVENUECAT_TEST_KEY`.
This builds Debug without the dev launcher and uses an owned Metro server on port 8099.
Expo development bundles require a server connection; an embedded Debug bundle cannot initialize.
Each run starts its own server, refuses a busy port, and records its process, source, configuration and served-bundle hashes.
Keep that server running through walkthrough, publication and merge; the gate rechecks its identity and bundle.
Use `node scripts/sim/product-flow.mjs stop-metro` after shipping.
It only stops the recorded process; the usual development server is untouched.
Test Store evidence does not establish Apple sandbox billing behavior.

Both configurations use local simulator signing with Xcode's application entitlement so SecureStore can read and persist sessions.
Use a disposable simulator: iOS app reinstalls preserve keychain sessions.
For a fresh-account run, explicitly set `FITSY_SIM_RESET_KEYCHAIN` to that simulator's UDID.
This clears its entire keychain before the baseline and records the reset.
Never set it for a simulator containing accounts you need to keep.

```sh
node scripts/verify/product-flow.mjs --plan
export FITSY_SIM_OWNER=my-task MAESTRO_BIN="$HOME/.maestro/bin/maestro"
node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs build <UDID>
# Inside the task-owned shipping script, invoked through shipping-session.mjs:
node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs run <UDID> <affected-flow-name> --mode=final-candidate
# Capture affected primary and recovery paths through Mobile MCP, then:
node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs finish .evidence/walkthrough.json
```

Cold-start and sign-in always run.
Add/select flows in `apps/mobile/e2e/flows/` tagged for every category in `--plan`, with at least two non-optional outcome assertions per changed journey.
Baseline flows cannot cover a paywall change.
Promote discovered regressions into deterministic scenarios.
Final candidate runs retain required assertions, raw Maestro commands, screenshots, XCTest capture receipts, timing and changed-journey walkthroughs without recording video by default.
When a reviewer explicitly requests video, add `--record-video` to the final candidate run; the runner retains complete untrimmed video and the validator checks each recording before publication.
Development runs remain separate from final publication even when recorded.

The walkthrough JSON is an array with one entry per category: `category`, `expected`, `observed`, `branches: ["primary", "recovery"]`, `result: "pass"`, and `trace` relative to `.evidence/product-flow/`.
Traces are JSONL: one `{at, command: {name}, result: {content}}` object per line, recording actual Mobile MCP actions and screen observations.
Identify run-owned synthetic fixtures with `FITSY_FIXTURE`; reviewers judge scenario relevance and visual quality.

### Keep mobile walkthroughs focused and recoverable

Before interacting, list the expected primary and recovery checkpoints, required assertions, and a task-appropriate action, retry and elapsed-time budget in the task evidence.
Use the accessibility screen or relevant subtree where supported to find visible controls and confirm semantic state.
Save complete successful Mobile MCP responses in the source-bound walkthrough trace, while bringing only the relevant controls and state change into working context.
Keep any failed response, including `isError: true`, in separate private diagnostic evidence because the product-flow validator rejects failed events in the walkthrough trace.
Record the failed attempt in the diagnostic action history and include a successful retry in the validated trace only after it actually changes or observes the required state.
If a target is offscreen, scroll to it deliberately, refresh the accessibility state, and verify reachability before tapping.
If accessibility data is missing or misleading, record that limitation and use a screenshot or another supported observation instead of inventing a selector.
Take screenshots at required outcomes and when checking layout, clipping, redundant controls or visual state that the accessibility tree cannot establish.
Inspect those images against the affected screen's acceptance criteria; semantic success alone does not establish visual quality.

Count attempts without a relevant state change across taps, selector variations, waits and restarts.
After two such attempts, save the current tree, screenshot and diagnostic action history, then diagnose the failed checkpoint before another action.
For a stale element, refresh the tree and reacquire the control.
For an overlay, inspect it, dismiss only a known safe overlay, and confirm the expected screen.
For delayed accessibility updates, use a bounded state-based wait and compare the screen image before treating the delay as an app failure.
At the planned budget boundary, record the failed step and cause through the normal recovery path; never turn a skipped assertion into a pass or replace it with a sleep.

Keep complete action responses and the selected raw log window in private task evidence, then read only a scoped excerpt during diagnosis.
For example, capture a short device window with `xcrun simctl spawn <UDID> log show --last 30s --style compact > .evidence/product-flow/device-log.txt`, then use `rg -n '<relevant-pattern>' .evidence/product-flow/device-log.txt` for the relevant lines.
Use `scripts/sim/sim logs --seconds 30 --grep '<relevant-pattern>'` when a quick bounded excerpt is sufficient.
Do not include credentials or personal data in published evidence.
Record actual tool calls, elapsed time, no-progress attempts, retries and evidence size if comparing flows; external speed claims are not Fitsy measurements.

```sh
node scripts/sim/publish-product-flow.mjs <PR_NUMBER>
```

The publisher requires a clean checkout matching the PR head and current main.
Deploy candidate backend changes to dev before testing.
The publisher rechecks source, app/configuration and backend identity, validates evidence no more than 24 hours old, and attaches verified commands, screenshots and traces to a **private draft** GitHub release.
Keep drafts unpublished.
Non-product PRs publish N/A without a simulator; `--include-baseline` optionally attaches a baseline validation run.

Main requires `product-flow/local` on the exact head.
Republish before merge; code/test changes require fresh evidence.
GitHub does not automatically expire an old success after 24 hours.
This trusts repository writers like the existing local reviews; it is not an attestation against an administrator.
Preserve existing required checks when configuring protection.
The shadow L7 smoke cannot satisfy this gate; cloud execution is not a launch requirement.

For a backend change before its first push, deploy a clean committed checkout with `vercel deploy --target=preview`, then assign the ready preview to dev during a coordinated test window.
The gate accepts Vercel's CLI `meta.gitCommitSha` identity as well as a Git deployment's `gitSource.sha`, rejects dirty CLI uploads, and still compares candidate backend contents and pins the deployment across the test and publication.

Commit the tested change locally before shipping admission; `--local` reviews committed `origin/main...HEAD`, not uncommitted edits.
Fetch the base first and ensure the branch contains the current review definitions.
If it predates the harness, rebase/update it deliberately in its own worktree before review; do not silently skip missing lenses.

Explicit independent review covers the required domains with the same required domains as the trusted-main poller:

| Changed surface | Required review domains |
|---|---|
| Every PR, including docs and tests | `correctness`, including maintainability and required acceptance |
| Production auth, billing or data-loss code | Also `danger-zone` |
| Production deployment/security or review/release controls | Also `workflow-security` |

Exact shared path routing is in `scripts/review/review-domains.py`; ordinary test, fixture and documentation paths do not trigger specialists by name alone, while review and release policy files do.
If the changed behavior exposes a sensitive control outside those paths, add the relevant specialist before merge.
An `incident` label, `Spec:` line or test file does not by itself add a separate lens; correctness still checks the named acceptance and relevant tests.

```sh
bash scripts/verify/review-admission.sh
# Admission revalidates the canonical matching result without provider execution.
# Required domain coverage and issue-wide budget history remain canonical.
```

Group material defects and mandatory acceptance failures into one repair pass, while preserving bounded P2 debt as owned, source-bound follow-ups.
After repair, review the affected behavior and its consequences against the current source; do not reopen unrelated adjudicated questions without new evidence.
After cheap/focused checks and a passing independent review, publish the frozen candidate through the ordinary hook.
Before protected merge, require trusted existing Verify and every applicable real-media/native flow, reusing only receipts whose source, environment and test identity still match.
Rerun invalidated checks and lenses after a source change; never reuse an old-head verdict as a fresh pass.
Review requirements are independent of the implementing agent, model vendor and subscription.
The runner supports `claude` and `codex` adapters; choose an authenticated provider explicitly with `FITSY_REVIEW_PROVIDER`.
Set `FITSY_REVIEW_MODEL` to the intended model; Codex defaults to `gpt-6-sol`, while explicitly selected Claude installations retain their tier-based defaults.
Use a model appropriate to the change's risk and keep the required lenses unchanged.
Export `FITSY_REVIEW_PROVIDER`, `FITSY_REVIEW_MODEL`, and `FITSY_REVIEW_REASONING_EFFORT` in the shipping shell before review.
Keep those exports for full verification and pre-push so every admission validates the snapshotted reviewer profile.
A supported Claude profile uses the same persistent-export contract.
Provider-specific credentials remain in the provider's normal local credential store and must never enter the repository or evidence.
The adapters run an independent review process with read-only tools, disabled integrations and bounded execution time.
`FITSY_REVIEW_TIMEOUT_SECONDS` configures the execution timeout.
For Codex, `FITSY_REVIEW_REASONING_EFFORT` defaults to `high` and supports `low`, `medium`, `high` and `xhigh`; unsupported model/effort combinations fail rather than silently changing settings.
The installed CLI and administrator-managed policy remain trusted infrastructure; the adapter constrains model tools and preserves the normal credential store.
Authentication, process, timeout and invalid-output failures cannot produce passing or reusable verdicts.
A supported alternative may resolve a provider outage, but never switch providers to evade a confirmed code finding.
The runner records provider, model and execution identity with the verdict, and includes that identity and adapter/parser contents in its cache key.
An existing status from another provider still satisfies the same lens; a cache entry is reused only for its matching execution identity.
The implementing agent must not author its own independent review verdict.
Existing post-PR compatibility callers may reuse a matching canonical round.
Local shipping admission revalidates matching complete evidence through authenticated immutable main controls.
The cache binds every required domain and instruction, provider identity, acceptance brief and patch; only optional hunk-heading labels are normalized.
The trusted main poller invokes the reviewer once and publishes `review/round` with its complete input identity after all required compatibility statuses.
Before reusing a completed same-head status, a nonexecuting identity probe checks current acceptance, routing, instructions, provider and patch inputs.
A changed identity requires one new complete round; identity failure withdraws reuse, and a retained needs-coordinator failure still requires diagnosis.
Existing `lens/<domain>` statuses are derived only from one complete independent result.
Missing domain results make the entire round incomplete.
PR patches are generated from the exact checked-out head and immutable target base commit, with a head recheck before execution.
Changed-input success statuses are withdrawn before replacement execution, including when the finite budget denies that execution.
Legacy `run-lens.sh` delegates the whole round and cannot run separate routine reviewers.
The default independent provider is Codex, model `gpt-6-sol`, high reasoning effort.
Each actual round execution or retry charges the retained issue ledger once; cached projections charge no new execution.
A changed diff or changed review inputs invalidates that reuse.
The selected skills and current human issue limits control execution and retry decisions.
Incomplete review is never a pass or an automatic retry entitlement.
An implementer cannot replace the independent required domains with its own assessment.
Every finding has a separate impact priority, and raw reviewer verdicts remain unchanged.
The canonical runner accepts an owned, source-bound P2 follow-up only through the disposition and required-test contract in [review-dispositions.md](review-dispositions.md).
P0/P1 impacts, malformed dispositions, stale receipts and missing required tests remain blocking.
Retain all actual execution, reservations, failures and original issue-bound limits across source repairs, providers and workers.
Do not infer a lifetime attempt count from one combined domain review.
True explicit human attempt limits and cumulative ceilings remain binding.
A coordinator-imposed count error may be reconciled only by the supported trusted operator, never by editing ledger bytes or installing candidate controls to approve themselves.
`review-budget.py reconcile-count` requires a private external operator manifest binding the original limit and complete ledger digests, candidate, issue and issue-bound coordinator/human provenance.
It appends one idempotent reconciliation event and preserves the original baseline, elapsed costs, timeout ceiling and cumulative stop.
It refuses unfinished or incomplete history, explicit human-count declarations, mismatched authority and capacity changes.
The existing prospective execution policy can narrow the remaining window; it cannot reset cumulative accounting or authorize an incomplete retry.
See [review-dispositions.md](review-dispositions.md#review-budget) for the retained ledger and disposition contracts.
Do not invoke an unreviewed candidate operator against a live ledger.
The permanent human exception permits issue463 bootstrap using a private external installation of the independently reviewed exact-source operator and authorized original raw evidence.
Set `FITSY_REVIEW_BOOTSTRAP_OPERATOR` only after that independent review and installation; this issue-specific path retains actual main identity and cannot admit nutrition.
`review-budget.py reconcile-allocation` appends a source-bound bounded allocation authorized by the private permanent human receipt, preserving the original limit and every elapsed attempt.
Completed failed bootstrap reviews are accounted as failed verdicts and cannot admit shipping.
All bootstrap allocations and execution must be reconciled before final acceptance.
After verified main release, install through the ordinary trusted-main path and stop using the bootstrap operator.
Exhaustion and admission refusal are neither review approval nor permission to bypass hooks.
P3 findings remain advisory; confirmed P0/P1, required tests and essential acceptance continue to block independently.
The Jev review-triage evaluation is a later shadow experiment under issue #372, with no gate or merge authority.
A rebase may alter the actual diff and requires checking again.

Local mode carries the bound issue brief, not the full PR body.
Keep release acceptance in that issue; if a requirement exists only in PR text, require a PR-context correctness review before relying on a cached local verdict.
Do not use the content-only cache as proof that changed requirements were reviewed.
The same applies when a reviewer relied on context outside the cached diff and that context changed.

Do not run another generic review after these project lenses solely because a global skill says to.
Use additional review only for a concrete uncovered risk or an explicit user request.

## PR, integration, and deployment

Open the PR with scope, intent, actual verification results, relevant evidence paths, and remaining limits.
State the coherent outcome, acceptance evidence, non-goals, owner, and blocking dependencies.
Use `--body-file` for multiline CLI PR bodies.
Include `Spec:` or the incident reference where applicable.
Check the current PR head, its CI, and required lens statuses before merging; an earlier commit's green result is insufficient.
Follow existing task authorization for push, merge, migration, and deployment.
If the user has already authorized the complete shipping sequence, continue through it without repeatedly requesting the same authorization.
Do not treat a request to discuss or prepare a proposal as authority to publish it.

Use the existing release tooling and documentation:

- API/landing: inspect the appropriate Vercel deployment for the merged commit; these are separate projects.
- Mobile JS: `scripts/deploy/ota.sh` and the iOS release runbook own the production OTA procedure.
  Production exports must use the production environment and valid RevenueCat/Supabase configuration.
  Native dependency/configuration changes require the appropriate binary build; an OTA cannot supply native changes.
- Database: use the documented migration and rollback process; a successful Vercel deployment does not prove a migration ran.
- Rollback: `scripts/deploy/rollback.sh` plus the relevant deployment runbook; record the previous deployment/update and data rollback evidence before publishing risky changes.
- Documentation-only work has no mobile/API deployment requirement.

Once merged, inspect BOTH the main **Verify** workflow and the applicable **Deploy** workflow at the resulting commit.
The September workflow-lint incident showed that PR-only checks and a green deployment can coexist with a failing main Verify.
Do not report production completion while that distinction remains unchecked.
Recheck the applicable authenticated user path, not only a public health endpoint.

## Evidence for completion

Record the branch/PR, reviewed head, merge commit, deployment/update identity, check results, and rollback target.
Identify failures that were fixed separately from checks that remain skipped, shadow, or untested.
A screenshot or video should show the changed interaction; a successful build is not equivalent evidence.

For subscription/onboarding changes, explicitly name the states tested: new user, active subscriber, lapsed subscriber, restore, delete/recreate, and delayed synchronization where affected.
Record whether evidence comes from RevenueCat Test Store, Apple sandbox/StoreKit, or production behavior and configuration.
Do not claim complete real-store validation from a simulator/Test Store purchase.

For data work, identify the source/reference facts, preserved identities, before/after rows, writer path exercised, and rollback proof.
Distinguish synthetic fixtures and estimates from independently verified reference data.

Finish with a concise state report:

- What changed and where it is available.
- Which of local verification, PR checks, main Verify, deployment, and product smoke have passed, with evidence.
- Any remaining blocker or untested path, and the next owner/action.

A background process existing is not proof that it will wake its owner.
When waiting, retain durable task state and use the harness's supported completion notification mechanism.
If the runner cannot continue automatically, report that limitation rather than promise an unverified future follow-up.

Protected release entrypoints execute `scripts/verify/shipping-session.mjs` and `scripts/verify/run.mjs` directly, using their trusted system Env startup wrapper.
Do not launch them through a caller-configured `node` process: Node startup imports run before module code can validate admission.
The executable wrapper clears `NODE_OPTIONS` and `NODE_PATH` and fixes administrator interpreter search locations before Node starts.
For npm verification aliases, clear those startup options before invoking npm; the pre-push hook and protected live child environment enforce this for shipping.
