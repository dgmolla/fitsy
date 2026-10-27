**TL;DR:** Cached Haiku failures are reproduced and quantified; changed-request DEV reruns are authorized and pending.

## Haiku format fix and rerun

This owner uses only `/Users/dawitmolla/fitsy-eval-suite` on `data/eval-suite-haiku-fix`, created from current `origin/main` at `c87dd14` after PR #568 merged.
The current user supersedes the historical no-retry interpretation below: never resend a byte-identical billed payload, but retry these failed cases using a changed Haiku request.
Scope is exactly 30 failed macro cases plus three failed matching cases from the frozen 129-case DEV sample.
Keep the strict decoder primary and report normalization only as a labeled secondary cache-only view.
No holdout evaluation, database, protected checkout, project board, hook bypass or admin merge is authorized.
Use the selected standalone ship-branch workflow and existing local AI reviewer; merge only with green CI and no local P0/P1.

The actual cache-only runner reproduced all 465 predictions in `2026-10-27T09-07-25-576Z-d1df9782`, adding zero requests and zero spend.
The maintained `haiku-format.ts` diagnostic validates original replay/billing provenance and generates `results/haiku-format-preflight/` plus the exact failed-case selection.
All 33 failed responses are completed JSON, containing 113 questions and 93 invalid question distributions.
There are 92 invalid totals spanning 0.977 to 1.600, with absolute sum deviations from 0.020 to 0.600, plus one argmax-only violation with a 0.475 gap.
Secondary normalization uses only the original consumed cache: matching parses all cases; macro parses 24/25 curated and 25/26 bulk.
Two normalized coarse choices need an uncached refinement and remain explicit cache misses without transport.
The original strict baseline remains unchanged.

Starting ledger is $0.57796218, SHA-256 `8a405dca7cd8eb51e4b94edfbc3b53f3ed7e921f2bb4e393468aa95cd9f44495`, with no pending reservation or unknown usage.
The cumulative stop is $2.70 and hard cap is $3, including all historical spend.
Recovery assessment: ship-branch, existing provider payload/schema, replay, ledger reservation and explicit case-selection entrypoints support the requested recovery.
The selected correction adds explicit Haiku probability-total and argmax instructions, recognizes both retained payload revisions, and retries only failed original requests while preserving successful cache entries and exact-payload deduplication.
The suite README and actual runner/provider tests will carry this correction into the consuming entrypoints; external skill edits are excluded by the workspace-only constraint.
The diagnosis is committed as `5c59769`.
The provider now adds the Haiku-only probability instruction and recognizes original versus changed payloads with exact serialized payload hashes.
Only an original format failure is replaced; successful original stages and all changed-payload attempts are reused, including failed changed attempts.
The budget planner sees original failures as requiring the fixed request and reserves both possible macro stages.
The comparison consumer now proves payload uniqueness, the preserved starting ledger prefix, failed-case-only spending, and separate before/after output failures versus wrong estimates.
The suite README documents the actual retry and detached collection entrypoints, while strict decoder tests and secondary normalization tests constrain their behavior.
The first focused test compile found a Node assert import incompatible with Jest's module settings; its supported named import corrects that without changing scoring.
Lint/type checks and the real comparison generator preflight pass before paid collection.
Next: freeze this implementation, complete actual-runner regressions, then run only the 33 selected cases detached with reservations before the cache-only four-method rescore.

## Prior comparison history

**TL;DR:** Re-parsing the completed 129-case DEV comparison without new bills and separating output failures from estimate error.

## Cached-output diagnosis and scoring continuation

The current owner resumes `data/eval-suite-haiku-qwen-run` at `a2ea9d394e3c76417a00d56d1b7d8e6fd45998f7`.
The later run `2026-10-27T08-03-39-011Z-0135102d` completed all 465 supported predictions, including the previously pending nine Qwen cases.
At entry, ledger SHA-256 is `8a405dca7cd8eb51e4b94edfbc3b53f3ed7e921f2bb4e393468aa95cd9f44495`, cumulative spend is $0.57796218 and Haiku/Qwen spend is $0.45402165.
No usage or reservation remains unresolved.
The latest instruction tightens the stop to $2.70 including historical Jev spend, with a strict $3 cumulative cap.
Never repeat a billed input, even when its returned estimate is invalid.

The actual end-user reproduction reads the retained HTTP bodies and applies the existing Jev decoder.
Haiku's failed macro bodies are valid completed JSON but violate the shared probability-total or argmax contract.
One example contains ten calorie probabilities summing to 1.31, rather than one.
No evidence supports repairing JSON syntax, normalizing the probabilities or treating the selected choice alone as a valid answer.
Those changes would weaken the unchanged Jev comparison contract.
The adapter currently loses that distinction by turning all exceptions into a generic failed output and replaying stored failure labels without re-parsing their original bodies.
The repair carries decoder-owned parse/format/timeout diagnostics through the real evaluator and re-parses all cached case-level failures using the unchanged strict decoder.
The runner gains a credential-free, transport-free model replay mode; cache misses refuse rather than spending.
Scoring retains the original failure-penalized all-case view and adds explicit failure counts plus parsed-only macro denominators.
Selected recovery tools are the ship-branch workflow, existing provider/replay primitives and canonical focused runner; altered prompts/schema, paid replacements, new credentials, holdout, database and board access are excluded.

The superseded collector finished and released `.jev.lock` before this owner started.
Under cleanup-agent-resources, the exact idle predecessor PID 68283, started October 26 at 23:11:47 local time, was terminated after matching its original task command and confirming no collector or lock.
Its dedicated CUA, REPL, Mobile MCP and code-mode children also exited; all source, raw journals, original ledger and `/private/tmp/hq2.log` remain retained.
Disk has 27 GiB available and memory reports 54% free; use one sequential focused-test job with a 2 GiB Node heap.
The source repair is committed as `366d3ac`, followed by the isolated mock-history correction `56240b8`.
All 60 focused regressions, suite lint and script type checks pass.
Initial development failures included a missing shared replay method, a synthetic Jev reservation using the wrong envelope, the intended dirty-source refusal and an uncleared test spy; each was diagnosed and corrected without a live request.
The actual cache-only run `2026-10-27T08-20-00-178Z-f95a6de8` completes all 465 predictions, with 527 reuse receipts, zero requests, zero new spend and a byte-identical ledger.
The report/audit generator is now maintained at `scripts/eval/suite/compare.cjs` rather than depending on a temporary session script.
It binds the same sample and previous complete audit, verifies all denominators and bills, retains original latency and emits per-request failure/probability diagnostics.
No failed case is recoverable under the unchanged decoder: Haiku macro failures are curated 14/25 and bulk 16/26, while Qwen has 8/25 and 7/26 format failures plus one timeout in each tier.
Haiku also has three matching format failures and Qwen has two; exact and Jev have none.
There are no unattempted Qwen cases and no eligible unseen Haiku request after strict replay, so the no-repeat requirement excludes additional live inference.
The scorer now shows Haiku parsed-only macro calorie medians of 37.5% curated and 51.4% bulk instead of conflating them with failed-output infinity.
The final executable source is frozen at `930fd96`.
Its 60 focused regressions pass, including the actual credential-free runner, byte-identical ledger, unmodified predictions and cache-miss stop reporting.
The final run is `2026-10-27T08-22-32-777Z-db8d6ccb`, with the same 129 IDs and 465 predictions, 527 reuse receipts and zero requests.
Its [comparison report](scripts/eval/suite/results/2026-10-27T08-22-32-777Z-db8d6ccb/comparison-report.md), [audit](scripts/eval/suite/results/2026-10-27T08-22-32-777Z-db8d6ccb/comparison-audit.json) and [failure diagnosis](scripts/eval/suite/results/2026-10-27T08-22-32-777Z-db8d6ccb/failure-diagnosis.json) are generated by the maintained source.
The audit proves no changed successful output, zero recovered invalid cases, no repeated paid input, no unknown usage, no pending reservation and the complete preserved original ledger prefix.
New spend for this continuation is $0; the full comparison's Haiku/Qwen spend remains $0.45402165 and the cumulative ledger including historical Jev remains $0.57796218.
The retained final same-key OpenRouter usage read equals all $0.03844965 of Qwen bills.
All provider p95 execution values in the re-score measure replay; the report separately retains the original live request durations, including censored timeouts.
The product plan computes `required=false` and simulator scope `none` because this changes evaluation tooling only.
A value-only in-memory scan of 130 result files finds zero credential matches; no key is printed or copied into results.
Inherited original/continuation raw evidence and both cache re-score runs are retained and committed rather than overwriting generated history.
The supported publication path remains the existing installed local AI reviewer, which supplies the exact-head `AI review` status after PR creation without this task accessing its protected checkout or controls.
The complete evidence is committed as `c0de04a` and [PR #568](https://github.com/dgmolla/fitsy/pull/568) is open with the requested title.
Canonical cheap checks and the ordinary pre-push hook pass all eight applicable checks, including 60 focused regressions.
The actual product publisher posts computed N/A on that exact head; the Vercel preview and trusted static/build CI are green.
The existing local review service was idle on its normal five-minute interval, so its supported non-killing launchctl kickstart requested one scan without inspecting or changing protected files, controls or review history.
Its source-bound `gpt-6.1-sol` review completes with no P0/P1 and one P2 correctness finding at [the retained raw verdict](https://github.com/dgmolla/fitsy/pull/568#issuecomment-6437251639).
The live planner checks a hypothetical all-b11 fine request rather than the actual cached refinement, so near the cumulative stop it can refuse a fully paid case that requires no inference.
This does not change the completed sample or its cost, and cache-only replay already provides recovery.
The current evaluation owner is nevertheless repairing the bounded replay deduction through the existing cache and planner, with an actual runner regression at $2.6995 and no network.
Paid prompts, schema, decoder, sample, outputs and bills remain unchanged.
Next: commit and validate that narrow review repair, refresh the exact-head local review/CI and product status, then use only `gh pr merge --squash` when every applicable gate is green without P0/P1.

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
The routing repair is committed at `19805640ccee0153f31f6403945cb44298b80fa9`, and all 54 focused tests pass.
The Qwen rejection is reconciled additively against its raw response and the exact retained zero-usage proof; ledger admission now has no unknown or pending usage before resumption.
The offline route-recovery preflight replayed all 129 Haiku cases, preserving every output and all 33 failed outcomes with zero new requests or spend.
The live continuation is `2026-10-27T06-53-51-562Z-3b1ecf75`, from that committed source and the original selection hash.
Its collector is PID 94334, parent 94310, started October 26 at 23:53:51 local time, with about 74 MiB resident memory when observed.
Retain the live collector and its `.jev.lock` until completion; do not repeat the command while it runs.
At 06:59:34 UTC, exact and Jev had completed, Haiku replayed all 129 cases, and Qwen had completed 36 cases with one failed model answer.
Known new spend at that checkpoint is $0.42016495; macro cases currently take about one minute each.
The current tool command session is 3718; reap its final exit and inspect the run's summary before any results commit.
The canonical product and simulator plans compute `required=false` and scope `none` for this evaluation-only change.
Next: let the original sample finish, run the offline same-sample/billing audit, commit all raw results and the full comparison report, then obtain cheap checks, exact-head local review and current CI before the authorized squash merge.

## Qwen body timeout and billing recovery

The live continuation stopped at Qwen case 44 when the body of an HTTP 200 macro response exceeded the fixed 60-second timer.
Retain request `29e09896-35e1-4c34-96ca-bc31c5180787` and its original unknown settlement; known new spend at the stop is $0.42528418.
The lost request belongs to the original curated macro case `waba-grill:mini-chicken-bowl` and reserved $0.00136077 before transport.
The failed output must remain failed and must not be retried.
Recovery assessment: official OpenRouter current-key/generation tools, the existing ledger and transport, the selected ship-branch workflow and read-only browser lookup were assessed.
Exact generation lookup needs an ID that the body-reading failure discarded; the activity API requires a management key, and the browser has no existing signed-in session.
No broader credential, new login, admin grant or interactive question was requested; the temporary browser tab was closed.
Two authorized same-key usage reads at 07:11:10 and 07:15:59 UTC remain identical, 289.436 seconds apart.
The daily total is $0.01041608 against $0.00971218 of known Qwen responses, leaving $0.00070390 for the sole unresolved request, below its reserved envelope.
The lifetime delta from the retained zero-daily baseline matches the daily total exactly.
This is an allocation from aggregate provider billing counters, not recovered token-level usage; preserve that distinction in the report.
The supported helper will require one unresolved reservation, retained body-timeout evidence, the same UTC day, a zero daily baseline, stable counters and a nonnegative delta inside the reservation, with additive hash-bound history.
Future Qwen calls get a measured 180-second body deadline and retain generation IDs from headers before reading a body; token and price limits remain unchanged.
Next: validate and commit this recovery, reconcile the single bounded charge without inventing an output, replay all paid inputs, then continue only unseen inputs on the original 129 IDs.
The recovery is committed at `4ef8f9fe3e8a56384c87df50ddd6cb33c4a92064`, and all 55 focused tests pass.
The actual helper allocated $0.00070390 from the retained counter proofs, leaving no unresolved or pending usage and $0.42598808 known new spend at resumption.
An offline transport-forbidden proof replayed all 129 Haiku outcomes and all 44 prior Qwen outcomes without a request or charge, retaining every prior failed outcome.
The live continuation is `2026-10-27T07-25-46-652Z-d4f0ef24` from that committed source; its command session is 25728.
Collector PID 29804, parent 29779, started October 27 at 00:25:46 local time and was observed at about 97 MiB RSS.
Do not start another collector or remove this live `.jev.lock`.
Qwen reached 49 cases with four failed outcomes at $0.43005242 total new spend; 11 actual response-header generation IDs prove the corrected transport is adopted.
The offline report/audit generator is retained at `/private/tmp/fitsy-eval-four-method-audit.cjs` and must run only after a complete summary exists.
It verifies all 465 supported method/case predictions, original sample and ledger prefix, zero repeated paid inputs, all metric denominators, replay/reference costs and original request timing; it writes `comparison-audit.json` and `comparison-report.md` in the completed run directory.
The full report must disclose the one usage-counter allocation, its unchanged raw missing output and censored latency, plus exact's unsupported macro surface.
Next: finish collection, verify the final same-key total against all Qwen bills, generate and commit results, then cheap checks, existing exact-head local AI review, green current CI and authorized ordinary squash merge.

The continuation reached Qwen case 120, then stopped at the 180-second body deadline on `bulk:measured:macro:wahoo-s-fish-taco:sides/side-beans-white`.
Known new spend at that stop is $0.45063298; request `f35dc8ce-c5aa-4b66-8716-b9d77794ed98` retained header generation `gen-1793087348-UAxn2yCJwJ6yiiCIlTqF`.
The changed stop was reported once; no human action or paid retry is requested.
Recovery assessment: the corrected header journal and ordinary authorized `GET /api/v1/generation` now provide the exact per-request bill, so broader access and aggregate allocation are unnecessary for this request.
The retained read reports the same DeepInfra Qwen canonical model, cancellation, 1,054 prompt tokens, 1,292 completion tokens and $0.00080546 total cost inside the $0.00136212 reservation.
Its 179.921-second generation duration explains the cancellation and supports a bounded 300-second deadline for unseen inputs at the unchanged 1,536-token limit.
Extend the existing timeout reconciler to consume that exact captured-generation proof, validating identity, completed/cancelled state, timing, token counts and reserved cost; keep the original missing output failed.
Next: commit and validate that exact-generation path, reconcile this charge, and finish the remaining nine unseen Qwen cases with all paid inputs replayed.

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
