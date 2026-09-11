# Shipping a Fitsy change

This is the operational procedure for any coding harness or entry point, including Slack, Claude Code, Codex, and future supervisors.
The executable checks remain in `scripts/verify/registry.yml`, `scripts/verify/risk-tiers.yml`, and `scripts/review/`.
`autonomous-shipping.md` describes the broader design and historical rollout; where its older entry-point instructions differ, use this procedure and the executable checks.

```mermaid
flowchart LR
    A[Implement in owned worktree] --> B[Local checks and product evidence]
    B --> C[Relevant local review lenses]
    C --> D[PR checks and reusable lens verdicts]
    D --> E[Authorized merge and deploy]
    E --> F[Main Verify plus Deploy plus product smoke]
```

## One branch owner and one review process

Inspect active worktrees and compare changes against each branch's merge base before integrating overlapping work.
Do not change another agent's checkout or force-push its branch.
Keep dependency chains explicit and rebase the dependent branch after its prerequisite lands.
Use a fresh checkout for integration/deployment when the primary checkout is occupied.
Do not use a feature-branch mobile publication as a substitute for integrating the intended release commit.

Run the following on the branch to be submitted:

```sh
npm run verify
# For changed production build behavior or required build evidence:
npm run verify:all
```

The pre-push hook runs layers 0–2 plus size/domain checks.
A hook pass does not replace the applicable product-flow verification or independent review.
The registry determines which checks apply and whether a check is blocking or shadow.

**Local product-flow gate.** Local iPhone E2E is blocking for mobile-facing changes. CI runs static checks, unit tests and builds; its optional simulator workflow remains experimental. `npm run verify` and pre-push require fresh `.evidence/product-flow/report.json` when impact selection applies. Missing tools, skipped/failed assertions, missing coverage and stale evidence fail; unrelated changes get explicit `not_applicable`.

Use an owned worktree, `npm run dev:env`, and an explicit simulator UDID. Keep public configuration in the ignored mobile environment file. The builder generates an embedded Release app, disables downloaded OTA updates, and records source/native/JS/configuration identities. A keyless build proves navigation only and cannot cover billing. Never publish credentials or personal data in evidence.

For RevenueCat Test Store, add `--test-store` to `build` and configure the public `EXPO_PUBLIC_REVENUECAT_TEST_KEY`. This builds Debug without the dev launcher and uses an owned Metro server on port 8099. Expo development bundles require a server connection; an embedded Debug bundle cannot initialize. Each run starts its own server, refuses a busy port, and records its process, source, configuration and served-bundle hashes. Keep that server running through walkthrough, publication and merge; the gate rechecks its identity and bundle. Use `node scripts/sim/product-flow.mjs stop-metro` after shipping. It only stops the recorded process; the usual development server is untouched. Test Store evidence does not establish Apple sandbox billing behavior.

```sh
node scripts/verify/product-flow.mjs --plan
export FITSY_SIM_OWNER=my-task MAESTRO_BIN="$HOME/.maestro/bin/maestro"
node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs build <UDID>
node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs run <UDID> <affected-flow-name>
# Capture affected primary and recovery paths through Mobile MCP, then:
node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs finish .evidence/walkthrough.json
```

Cold-start and sign-in always run. Add/select flows in `apps/mobile/e2e/flows/` tagged for every category in `--plan`, with at least two non-optional outcome assertions per changed journey. Baseline flows cannot cover a paywall change. Promote discovered regressions into deterministic scenarios.

The walkthrough JSON is an array with one entry per category: `category`, `expected`, `observed`, `branches: ["primary", "recovery"]`, `result: "pass"`, and `trace` relative to `.evidence/product-flow/`. Traces are JSONL: one `{at, command: {name}, result: {content}}` object per line, recording actual Mobile MCP actions and screen observations. Identify run-owned synthetic fixtures with `FITSY_FIXTURE`; reviewers judge scenario relevance and visual quality.

```sh
node scripts/sim/publish-product-flow.mjs <PR_NUMBER>
```

The publisher requires a clean checkout matching the PR head and current main. Deploy candidate backend changes to dev before testing. The publisher rechecks source, app/configuration and backend identity, validates evidence no more than 24 hours old, and attaches verified commands, screenshots and traces to a **private draft** GitHub release. Keep drafts unpublished. Non-product PRs publish N/A without a simulator; `--include-baseline` optionally attaches a baseline validation run.

Main requires `product-flow/local` on the exact head. Republish before merge; code/test changes require fresh evidence. GitHub does not automatically expire an old success after 24 hours. This trusts repository writers like the existing local reviews; it is not an attestation against an administrator. Preserve existing required checks when configuring protection. The shadow L7 smoke cannot satisfy this gate; cloud execution is not a launch requirement.

For a backend change before its first push, deploy a clean committed checkout with `vercel deploy --target=preview`, then assign the ready preview to dev during a coordinated test window.
The gate accepts Vercel's CLI `meta.gitCommitSha` identity as well as a Git deployment's `gitSource.sha`, rejects dirty CLI uploads, and still compares candidate backend contents and pins the deployment across the test and publication.

Commit the tested change locally before reviewing it with the local review runner; `--local` reviews committed `origin/main...HEAD`, not uncommitted edits.
Fetch the base first and ensure the branch contains the current review definitions.
If it predates the harness, rebase/update it deliberately in its own worktree before review; do not silently skip missing lenses.

Use the same lenses that the project poller selects:

| Condition | Required local lens |
|---|---|
| Low tier | `docs-sanity` (advisory) |
| Medium/high tier | `correctness` |
| High tier | Also `danger-zone` |
| Incident | Also `harness-audit` |
| PR declares `Spec:` | Also `spec-conformance` |
| CI/deployment paths selected by the poller | Also `workflow-security` |
| Test files selected by the poller | Also `test-quality` |

Determine the tier using `scripts/review/tier.mjs`; exact routing is in `scripts/review/poller.sh`.
Do not reinterpret every change as the highest tier.

```sh
bash scripts/review/run-lens.sh --local correctness
# Substitute/add each applicable lens from the routing above.
```

Address confirmed findings, commit the fixes, and rerun affected checks/lenses.
The runner caches by the diff, lens instructions, REVIEW.md, and model.
A matching post-PR pass should reuse the local verdict rather than duplicate the expensive review.
A changed diff or changed review inputs invalidates that reuse.
A rebase may alter the actual diff and requires checking again.

Local mode does not carry the full PR body into its review context.
For a spec-conformance judgment that depends on the PR's linked spec or acceptance text, ensure the reviewer actually reads that spec; require a PR-context review when the local evidence does not establish conformance.
Do not use the content-only cache as proof that changed requirements were reviewed.
The same applies when a reviewer relied on context outside the cached diff and that context changed.

Do not run a separate generic `/code-review ... high` after these project lenses solely because a global skill says to.
Use additional review only for a concrete uncovered risk or an explicit user request.

## PR, integration, and deployment

Open the PR with scope, intent, actual verification results, relevant evidence paths, and remaining limits.
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
