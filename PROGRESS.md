**TL;DR:** Running the fixed 129-case DEV comparison with cached Jev and a $2.70 new-spend stop.

# Haiku and Qwen sample execution

The current task owns `data/eval-suite-haiku-qwen-run` in `/Users/dawitmolla/fitsy-eval-suite`, starting at main `89a6885f68decf87df22dc1e1c904c4095a096ed`, including merged PR #566.
The human authorized the four-method DEV comparison, process-only sourcing of `~/Desktop/secrets.env`, committed results, PR `data: haiku + qwen dev sample comparison`, and `gh pr merge --squash` only after green CI and local AI review without P0/P1.
Never evaluate holdout, connect to a database, touch `~/fitsy-refactor`, edit project boards, bypass hooks or use an admin merge.
The selected standalone ship-branch skill and Fitsy/cutover references control shipping; the existing external local reviewer must supply exact-head independent review.

## Preflight and fixed evidence plan

Read the previous progress, additive spend ledger and paid caches before any paid request.
The initial ledger is 1,245,175 bytes and 6,722 events, SHA-256 `ad837186b1b70bf6841a0984ca7d12a129dc04c9616d8e4ce1873d4b134924ac`, Git blob `08dffcfaaf065a29ce51cdb826514ed4e2336a6b`.
It retains $0.12394053 historical Jev spend, zero Haiku/Qwen spend, no pending reservations and no unknown usage.
The validated Jev cache has 3,179 unique canonical requests and no failed entries; no Haiku/Qwen exchange files or holdout run log exist.
`modelSelection` at $2.70 selects exactly 129 DEV cases: curated matching/macro 34/25 and bulk matching/macro 44/26.
The ordered selection SHA-256 is `3ec69529643a0253f95c4e04f927fe0d157c2d9fef14891af309962015a4fa70`.
The conservative reservation is $2.69768053, compared with $44.02095118 for full DEV.
All four methods must retain this selection; exact has no macro estimator, which must remain explicitly unavailable rather than invented.
Jev must use its transport-free replay client; never rerun a previously paid input.
Report matching pass/wrong/recall/abstain, macro errors and strict pass metrics, method costs/latencies, replay limitations and actual new spend with raw evidence.

The first process preflight found the expected uppercase keys missing.
Recovery assessment: the selected ship-branch workflow and existing shell/runner support safe process-only mapping; unrelated credential sources and connectors are excluded.
The approved file actually exports `anthropic` and `openrouter`; sourcing followed by explicit in-memory mapping proves `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` present by name only.
No key value was printed or written to the repository.
The runner now reports these legacy-name recovery hints before transport, with an actual-entrypoint regression and documented invocation, closing the naming failure in the supported consumer.
A one-off value-free diagnostic had a JavaScript parenthesis typo; the corrected presence check passed without any transport.
At entry, disk has 27 GiB free and system memory reports 54% free.
Use one sequential evaluation/test job with a 2 GiB Node heap, no database, native build or simulator, then release its compute before waiting on remote gates.
Next: run focused regressions, commit source and this preflight, then execute the frozen paid comparison once.

## Live failure and continuation recovery

Credential recovery and all 43 focused tests passed on committed source `4bf7489`.
The actual four-method run `2026-10-27T06-17-06-088Z-4ba60377` retained the exact 129-case selection hash and completed all 78 exact matching and 129 Jev cases using 179 cached requests.
Execution then stopped after four Haiku requests because the fourth answer's probabilities sum to 1.5.
All four calls are settled for $0.004918, with no unknown usage; Qwen has not started.
The stopped execution was reported once, with no human action required.
Recovery assessment: the selected ship-branch workflow, existing replay/billing primitives and supported `--cases` entrypoint permit a source-bound continuation; paid retries, probability normalization, prompt changes, dropped cases and another credential source are excluded.
The existing model client lacked cross-session replay and treated a billed invalid answer as a global collection stop.
Repair that consumer to replay successful and failed paid responses durably, count known invalid model answers as case failures while continuing other cases, and retain global stops for billing, identity, reservation and transport failures.
Freeze the original ordered sample as a source selection and prohibit silent resampling of an explicit paid selection.
Keep all prompts, schemas, model identities, bins, ground truth and decoder validation unchanged.
Regressions must prove the observed 1.5 probability failure remains failed across sessions with no new bill, valid cases still run, and missing or altered billing/exchange evidence refuses collection.
Next: commit and validate this bounded recovery, then resume the same 129 IDs using the four already-paid Haiku responses without new requests for those inputs.
The offline continuation preflight consumed the actual retained four Haiku exchanges with transport forbidden: three successes and the original invalid answer were replayed, with zero requests and a byte-identical ledger.
It proves the original ordered selection hash and all 129 cases fit a $2.65188553 remaining reservation within the $2.695082 remaining stop allowance.
The first recovery regression run found one obsolete budget assertion that expected a cached request to incur a new reservation; it now proves free replay succeeds and an unseen input is denied before transport near the stop.
The failed budget case and fatal identity/envelope controls pass, and suite lint/type checks pass.

The recovery commit `ffeb06e` passed all 50 focused tests and the actual continuation `2026-10-27T06-25-33-209Z-4cb048df` reused all four prior paid Haiku responses.
It retained the original sample hash, completed all 34 curated Haiku matching cases, then stopped when Anthropic rejected the first macro schema with HTTP 400 `invalid_request_error`: its compiled grammar was too large.
Known new spend is $0.047382 across 34 billed Haiku requests; the additional compiler rejection initially recorded unknown usage because it carries no model message or token usage.
Qwen has not started; the second stopped execution was reported with no request for human action.
Recovery assessment: the selected ship-branch workflow, retained raw response, official Anthropic structured-output/error contracts, existing ledger and source selection support a narrow repair; broader billing/admin credentials, discarded evidence and any paid retry are excluded.
Official docs describe grammar complexity as a request-compilation HTTP 400 and support internal `$ref` definitions.
Use shared equivalent macro answer definitions to reduce grammar duplication without changing questions, task inputs, allowed choices, required probabilities, decoder validation or model settings.
Append a zero-inference reconciliation bound to this exact retained HTTP 400 response, keeping its original unknown settlement intact; no other unknown-usage case may be cleared by that path.
Regressions cover legacy unknown refusal, exact evidence/hash binding, non-400 refusal, additive history, unbilled rejection handling, equivalent schema constraints and ordinary continuation.
Next: validate and commit the compilation repair, reconcile only the documented pre-inference rejection through the supported helper, then continue the original sample using all 34 billed Haiku responses from cache.
Compilation/reconciliation regressions and suite lint/types pass, including exclusive-lock refusal and evidence tampering refusal.
The first full regression run passed 52 cases and caught a test assumption that the cheaper equivalent grammar would still sample 129 by default; its new prospective bound fits 138.
The task explicitly retains the original 129 IDs, so the regression now checks that frozen selection's hash and 34/25/44/26 counts separately from general budget sampling.
Do not use the newly cheaper full-population selector to expand this run.

## Qwen provider recovery

All 53 focused tests passed on `4a917c3`, the actual macro schema expands byte-for-byte to the original schema, and the grammar rejection received an additive hash-bound zero-inference receipt.
The offline recovery replayed all 34 billed Haiku responses (32 valid and two invalid) with transport forbidden, then the actual run `2026-10-27T06-37-12-117Z-a1a11c12` completed all 129 Haiku cases.
Qwen's first request stopped with HTTP 400 because OpenRouter routed it to GMICloud, whose raw `BadRequest` says the model is deprecated and unavailable.
Known new spend is $0.415572, entirely Haiku; the unserved Qwen request initially recorded unknown usage.
The stopped execution and supported recovery were reported once, with no human action requested.
Recovery assessment: official OpenRouter routing/error/current-key tools and the selected ship-branch workflow support pinning the same model to an advertised compatible endpoint and independently reading usage; model substitution, automatic fallback, paid repeats and broader credentials are excluded.
OpenRouter's live metadata advertises `deepinfra/fp8` with structured outputs, temperature and the existing $0.09/M input / $0.55/M output ceiling.
The authorized same-key read-only `GET /api/v1/key` at 06:47 UTC reports daily usage $0 and BYOK usage $0 after the 400, independently proving no new Qwen bill; historical lifetime usage is kept separate.
Only numeric usage and endpoint/time were retained, never key values, labels or account identifiers.
Pin Qwen's provider in the actual transport and metadata, keeping its model, prompts, decoding, parameter requirements, disabled fallbacks and price ceiling unchanged.
Consolidate rejection reconciliation through `reconcileRejection`: this exact Qwen deprecation error also requires the same-day zero-usage receipt hash, while other missing usage stays blocked.
Next: validate and commit the routing repair, append that exact evidence-backed reconciliation, then resume the original 129-case selection with all Haiku outputs replayed and no repeated paid input.

## Previous adapter task history

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
Baseline evidence and the explicit unavailable-paid-run result are committed at `1dee689`.
All eight applicable cheap canonical checks passed; migration safety is legitimately skipped because no migration changed.
The focused selector initially retained only the old suite; the supported setter now selects both suite and provider tests so the ordinary hook consumes all 42 regressions.
The repository API-key review adapter is unavailable because `CODEX_API_KEY` is absent; no substitute credential or implementer verdict is allowed.
The existing subscription reviewer must publish its own exact-head `AI review` after PR creation, without this task reading or modifying its protected checkout, state, controls or attributes.
If that existing reviewer cannot run or rejects input size, report the genuine failure and leave merge blocked; do not alter it.
PR https://github.com/dgmolla/fitsy/pull/566 opened on `e963596` after ordinary hooks passed all eight cheap gates and all 42 focused tests.
The initial product-flow publisher fetched current main and refused because new main `79a47ec` was not yet an ancestor of this branch, retaining a genuine failed status on the old head.
Recovery assessment: the selected ship-branch skill, normal Git merge and existing product-flow publisher provide the supported recovery; changing its freshness check or any reviewer control is excluded.
Merged `origin/main` normally without conflicts, retaining all task commits and the source-bound historical replay.
The next publisher invocation correctly refused the unpublished local merge head; publication must follow the ordinary push before evidence is republished.
The upstream change adds optional simulator Slack previews and does not change eval adapters, prompts, fixtures or scoring.
The existing publisher's exact-ancestor and exact-remote-head guards detected both conditions; no control change is needed to prevent an unsafe publication.
Next: push the reconciled frozen head through ordinary hooks, publish computed N/A, then await current-head CI and the existing independent local review without protected-checkout access.

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
