**TL;DR:** Adding dev-only Haiku/Qwen adapters with shared Jev prompts, replay-only Jev and a $2.70 stop.

# Haiku and Qwen dev comparison

The current task owns `data/eval-suite-haiku-qwen` in `/Users/dawitmolla/fitsy-eval-suite`, starting at `ec1da10` from main.
The human approved Haiku and Qwen for this run only, dev only, inference/read-only API calls only, no database connections, no board edits, no hook bypass and no access under `~/fitsy-refactor`.
The requested PR is `data: eval suite haiku + qwen adapters and dev baseline`, with ordinary squash merge only after green CI and a source-bound local AI review without P0/P1.
The prior task history below is retained; its Anthropic prohibition is superseded only for this run.

## Current evidence and next action

The exact requested command currently refuses the disabled model stubs before transport.
Haiku uses the existing production alias `claude-haiku-4-5`; the open-model spike pins Qwen to `qwen/qwen3-235b-a22b-2507` on OpenRouter.
The old provider helper referenced by the spike is absent at this revision, so use its documented model identity and verify current public provider contracts.
Read-only OpenRouter model metadata reports $0.09/M input and $0.55/M output; Anthropic documents $1/M input and $5/M output for Haiku 4.5.
Never use the stale April Haiku price of $0.80/$4.
No new paid calls have occurred.

Credential discovery selected only names, never printed values, in `~/Desktop/secrets.env`, conventional env files in this checkout, and conventional `~/fitsy` env paths.
The named secrets file contains only the legacy Jev credential among relevant keys; neither `ANTHROPIC_API_KEY` nor `OPENROUTER_API_KEY` exists in those files or the process environment.
Live paid execution is therefore stopped before transport; no human action is requested under the instruction to make conservative choices without questions.
Recovery assessment: filesystem/dotenv tools support narrow in-memory loading; available connectors have no relevant credential reader, and unrelated hosting/credential sources are excluded.
Close the recovery loop in the actual runner with combined credential preflight, documented allowed sources and an actionable secret-safe failure receipt.
Continue implementing adapters, meaningful transport/budget regressions, full dev exact/Jev replay, checks and PR preparation.
Do not invent Haiku/Qwen measurements if credentials remain unavailable.

The selected ship-branch skill and standalone Fitsy/cutover references control shipping.
One sequential local test job has a 2 GiB Node heap estimate, with no simulator, DB or native job needed; disk has 26 GiB free and memory-pressure output reports 58% free at entry.
The first 41 focused tests passed across the original suite and the new provider transports/budget tests.
The initial test run found one obsolete disabled-stub assertion; it now verifies explicit client admission and dev-only selection.
The adapters share the original matching/coarse/fine builders and decoder, with unchanged Jev task prompts and protocol identity.
The new session uses the existing ledger and lock, retains old entries, counts Haiku/Qwen spending across invocations, reserves the entire response envelope and stops at $2.70.
Jev in a paid-model comparison uses a transport-free replay client; an explicit `--replay-only` mode also supports credential-free baseline recovery.
The credential failure now names both missing keys in one secret-safe receipt before any request or reservation, and the actual entrypoint's regression covers that recovery contract.
Execution source was frozen at `9be5a0c24e9e9b666d767907c407dc7ede23c66c`.
All 42 focused tests now pass, including the actual runner using both provider-shaped network fixtures and both estimator stages; scripts lint and type checks pass.
The exact requested four-method command produced `results/2026-10-27T05-18-29-842Z-7a919c80/failure.json`, naming both missing keys before transport.
The full dev exact/Jev replay completed in `results/2026-10-27T05-18-34-761Z-1e20c0af` across all 3,007 dev cases, without sampling.
It retained 5,688 method/case predictions and 3,331 exact-request Jev reuse receipts, with zero new requests, zero new spend and no unknown usage.
The cumulative ledger remains byte-identical to the starting main blob `08dffcfaaf065a29ce51cdb826514ed4e2336a6b`, retaining $0.12394053 of historical Jev spend.
A first one-off audit attempted to buffer the 1.5 MB ledger through Git's stdout and hit Node's default buffer ceiling; the corrected audit compares Git blob identities and records the independent SHA-256 without transporting the large blob through that buffer.
No paid work was repeated during that diagnostic recovery.

The prospective common paid-model sample is 129 cases: curated matching/macro 34/25, bulk matching/macro 44/26.
Its conservative reservation is $2.69768053 versus $44.02095118 for all 3,007 dev cases.
This is a frozen prospective selection only; neither paid model ran and no sampled quality metrics exist.
The measured exact/Jev results instead cover full dev and their cost/latency are marginal replay values, not fresh provider performance.
The canonical product plan computes N/A and simulator scope none.
Next: commit baseline evidence and docs, complete cheap gates, open the requested PR through ordinary hooks, and inspect existing local-review and CI status without reading or modifying the protected checkout.

## Previous task history

**TL;DR:** Extending PR #558 with verified measured-menu seeds while preserving the frozen v1 population.

# Eval suite seed extension

## Scope and ownership

The existing Codex task owns `data/eval-suite-v1` in `/Users/dawitmolla/fitsy-eval-suite` and PR https://github.com/dgmolla/fitsy/pull/558.
The human authorized source verification, small committed changes, dev-only evaluation, push, current-head CI and independent local AI review, then ordinary squash merge only when green without P0/P1 findings.
No GitHub project board edits are authorized.
`/Users/dawitmolla/fitsy-pdf-match` at `data/pdf-match-scope` is read-only; `/Users/dawitmolla/fitsy-refactor` must not be modified, including reviewer state and attributes.
No hook bypasses, admin merge, database commands or Anthropic calls are permitted.
Normal post-merge deploy automation is authorized; this change must add no migrations or production writers.

## Starting evidence

- Both task worktrees were clean at entry.
- Existing suite head: `bbd8ce41c92dfcbc33eb39d1f3783245b7e57eb9`.
- Existing PR #558 is open on this branch.
- The cumulative spend ledger has 2,957 reservations and 2,957 settlements, no pending or unknown usage, and **$0.10539795** spent.
- The cumulative hard cap is $5; the existing collector stops at $4.50.
- Existing dev/holdout sizes: curated 204/116; bulk 2,508/1,134.
- Claim Jumper remains entirely holdout-only; old serving, case and candidate assignments must be preserved.
- The source measurement contains 259 UE items across Wahoo's, Claim Jumper and Old Spaghetti Factory.
- Source reports 17 multi-row OSF hits plus one multi-row Claim Jumper hit; title equality alone is not ground truth.

## Evidence plan and next action

Read the source measurement and official documents, then record reviewed bindings, explicit candidate-relative negatives and item-level exclusions.
Copy only required source evidence into this checkout, add optional row tags without targets leaking into adapters, and extend splits without moving existing cases.
Regenerate fixture artifacts and the human case list using their generators; record old/new checksums and preservation checks.
Exercise the actual dev runner on affected/new cases, replay any identical previously paid requests, and retain additive billing history.
Run focused tests and cheap gates, freeze committed source, obtain exact-head independent review, push normally, and follow current-head CI through authorized integration.
If reviewer input exceeds the installed limit, report it and retain the failure without altering the reviewer.

## Workflow and resource notes

Using the human-selected standalone `ship-branch` skill and its Fitsy/cutover references.
No mobile, database, scraper or pipeline runtime is needed for offline seed construction.
Use the existing installed local review publisher; do not create another review pipeline or modify the protected checkout.
Record each material checkpoint and the next action here before yielding or ending the session.

## Seed construction checkpoint

Copied the measurement and three successful UE captures from source head `3e8f13afb05f8aba0fc10744484c5d1d023fc6ce`, retaining their SHA-256 identities.
The explicit source-first plan admits 176 observations (Wahoo's 61, Claim Jumper 20, OSF 95) and excludes 83 (18/54/11), with item-level reasons in the fixture manifest.
All 17 OSF multi-row hits, seven gluten-sensitive hits and 12 catering folded-title hits are included; these sets overlap.
Excluded catering garlic bread and the extra Claim Jumper potato collision after checking their ambiguous serving evidence.
The official-source checker verifies 118 selected rows against 28 physical PDF pages and labelled OSF HTML cards; seven references already existed, and 111 are new.

The extension adds **480 cases**, making 4,442 total: curated matching 224, curated macro 178, bulk matching 3,702 and bulk macro 338.
The complete original 3,962 case objects, including candidate lists and splits, compare equal to the starting commit.
Dev/holdout counts are now curated matching 143/81, curated macro 112/66, bulk matching 2,538/1,164 and bulk macro 214/124.
All 27 focused tests, scripts lint/type checks, source verification and fixture/case-list reproduction pass locally.
There are 295 new dev cases and 91 existing dev matching cases whose projected candidates acquire source tags.
Next: add exact-request paid-call replay and an explicit affected-dev selection, then run both methods only on that selection from committed source.
No new paid requests, database commands, Anthropic calls, source-checkout writes, protected-checkout writes or project board edits have occurred.

## Replay and affected-selection checkpoint

Added a generated 386-case dev-only selection (295 new cases plus 91 existing matching cases with newly tagged candidate projections).
The live collector now replays exact canonical requests from reconciled paid exchanges, including duplicates across tiers, and records the original request identity without another charge.
It refuses missing paid evidence and previously billed unsuccessful identical requests.
All 31 focused tests pass, including replay across invocations, changed-tag invalidation, failed-paid refusal and selection boundaries.
One temporary fixture initially lacked the new generated selection's parent directory; the fixture now creates output parents, and both the failed case and full focused suite pass.
Scripts lint and type checks pass.
The actual offline runner completed the 386-case selection; that uncommitted-source diagnostic is retained and is not the final baseline.
The next action is a clean-source exact/Jev dev comparison, then commit its results and current documentation before final gates and publication.

## Publication and credential recovery checkpoint

Pushed `e5376fb5ae34cc913adbdca3d3f6ae80e620a0b3` normally to PR #558 after all eight applicable cheap gates and the ordinary pre-push checks passed.
The exact-head product/media publisher computed and published N/A; the supported simulator plan has scope none.
Trusted Verify is running, Vercel preview is green, and the existing local reviewer is reviewing this exact head with `gpt-6.1-sol`.
No reviewer controls, state, attributes or protected checkout files were modified.
The original paid history validates as 2,775 unique canonical requests, with no unsuccessful or missing paid exchanges.

Live Jev collection is stopped before any request because this shell has no credential and the earlier handoff omitted the authorized credential-file path.
Recovery assessment: the filesystem/shell tools can safely map the existing legacy `jev` variable to `TYPESAFE_API_KEY` once the known file is identified; no installed connector supplies this credential.
Value-free filename checks and known evaluation-environment checks did not locate it, so the existing owner requested only the file path through the asynchronous user-input tool.
Do not search unrelated credentials, load production environment files, use another provider or repeat paid work as a fallback.
The PR body records this actual stop and the remaining action; no human release approval is being requested.
Keep the eventual authorized credential location, without its value, in this handoff so a later session can resume without repeating discovery.
All independent offline preparation is complete, and CI/review can continue while that path is supplied.

## Credential recovery and independent review

Recovered the previously authorized file path from `/private/tmp/fitsy-eval-suite-status.md`: `~/Desktop/secrets.env`.
The file exists and contains a usable Jev credential; only `TYPESAFE_API_KEY` or legacy `jev` is selected, never other environment entries.
The secret is mapped in memory into the child collector process and is never copied into this repo, printed or evaluated as shell code.
No human action is needed on the pending path question.
This handoff now records the location to close the demonstrated continuation failure; the existing value-free runner preflight, selected-case entrypoint and paid replay remain the supported recovery path.
The existing local AI reviewer passed correctness and workflow-security on `e5376fb5ae34cc913adbdca3d3f6ae80e620a0b3` with no findings.
CI static and build passed; tests continue.
Next: run the committed affected-dev exact/Jev comparison, record cost and zero-duplicate-request proof, and publish the final source/evidence head for fresh gates.

## Completed affected-dev baseline

The combined run `2026-10-27T01-10-06-197Z-2e7de0b8` completed from committed source `75bf11f867574757af486115fd7d295c3d2d7806` on all 386 selected dev cases without sampling.
It made 404 new Jev requests and replayed 61 identical paid requests for **$0.01854258**.
Total reported Jev spend is **$0.12394053**, with no unknown usage or collector stop.
The source-bound replay audit proves zero repeated paid inputs against the earlier session, zero duplicate paid inputs within this run and preservation of the complete original ledger prefix.
No holdout cases or Claim Jumper inputs were evaluated.

| Affected dev matching | N | Exact pass | Jev pass | Exact/Jev wrong | Exact/Jev recall | Jev abstain |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Curated | 49 | 83.7% | 69.4% | 0/0 | 42.9%/50.0% | 15 |
| Bulk | 258 | 95.7% | 86.4% | 0/1 | 89.3%/86.4% | 32 |

Jev all-four macro pass is 0.0% on ten curated cases and 4.3% on 69 bulk cases.
Frequent abstention fails the fixed exact-NO-MATCH metric; no method or prompt was changed after observing these results.
The original full-v1 baseline remains separate, with its original denominator and history.
The source checkout remains clean on its original unpushed head; no protected checkout or project board edits occurred.
Next: commit and publish the final evidence/docs head, require fresh trusted Verify and existing local AI review, then squash merge only if all gates are green and no P0/P1 findings exist.
