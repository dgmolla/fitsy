**TL;DR:** Run matching and estimation with shared Jev-v3 prompts, explicit provider selection, replay and additive budgets.

The maintained specification is [eval-suite.md](../../../docs/engineering/pipeline/eval-suite.md).
The [curated list](../../../docs/engineering/pipeline/eval-suite-cases.md) shows every curated input, expected output, category, rationale, and source page.
Install repository dependencies with `npm ci` before invoking the TypeScript entrypoints.

```sh
# Offline; no key, network, dotenv loader, or database.
npm run eval:suite -w scripts -- --methods=exact --split=dev --tier=both

# Verify immutable fixture bytes and human review list without evaluating holdout.
node --import tsx scripts/eval/suite/build.ts --check
node --import tsx scripts/eval/suite/list-cases.ts --check

# Explicit live dev comparison, in a clean committed source checkout.
# Load only the selected authorized keys into the invoking process; never print them.
npm run eval:suite -w scripts -- --methods=exact,jev-v3 --split=dev --tier=both --live

# One-run-approved Haiku/Qwen comparison; Jev is automatically replay-only.
# Requires ANTHROPIC_API_KEY and OPENROUTER_API_KEY; does not require a Jev key.
npm run eval:suite -w scripts -- --methods=exact,jev-v3,haiku,qwen --split=dev --tier=both --cases=haiku-qwen-dev-sample.json --live

# Recover a dev baseline without credentials or any paid transport.
npm run eval:suite -w scripts -- --methods=exact,jev-v3 --split=dev --tier=both --live --replay-only

# Re-parse the fixed four-method sample without credentials or paid transport.
npm run eval:suite -w scripts -- --methods=exact,jev-v3,haiku,qwen --split=dev --tier=both --cases=haiku-qwen-dev-sample.json --live --replay-only

# Generate the comparison from a cache-only run and its completed baseline audit.
node --import tsx scripts/eval/suite/compare.cjs <replay-run-id> <completed-baseline-run-id>

npm run lint:suite -w scripts
npm run type-check -w scripts
npm test -w scripts -- --runInBand --runTestsByPath eval/suite/suite.test.ts eval/suite/providers.test.ts

# Recheck the fetched, hash-pinned source PDFs. This command has no network code.
python3 -B scripts/eval/suite/sources/verify-pdfs.py --pdf-dir=/path/to/downloaded-pdfs
```

`--split` accepts `dev` or `holdout`; `--tier` accepts `curated`, `bulk`, or `both`.
Every holdout invocation appends start and terminal receipts to `results/holdout-runs.jsonl`, including checksum/preflight failures.
Do not invoke the real holdout while building or tuning this version.
Tests exercise holdout logging only with synthetic Toy Chain fixtures in temporary directories.

`results/<UTC-run-id>/` retains the source/protocol/selection identities, predictions, typed provider exchanges, summaries, and Markdown comparison.
The CLI and `report.md` show overall, per-chain and per-category results for each selected tier/task/method.
Every score in `summary.json` also includes a `chains` map using that chain's complete selected denominator, including failed and unattempted cases.
Original fields and historical summaries retain their meaning; comparison accepts older summaries without this additive map.
`results/spend.jsonl` is the additive cumulative suite-wide spending history.
It is never reset between commands or split/tier selections.
`.jev.lock` enforces one live collection at a time.
After an interrupted process, verify the recorded PID has ended before removing only its stale lock.
A pending reservation or unknown usage blocks collection until the supported reconciler validates retained provider evidence within the original reservation.
Unverifiable billing stays blocked; removing a lock never clears that history.

`--initialize` creates fixtures only when no frozen output exists.
It refuses to overwrite an existing suite.
Expected-output changes and checksum updates need human review in a versioned PR.
Result artifacts never supply new ground truth.

If the authorized credential file exports the legacy name `jev`, map it only in the invoking process before selecting `--live`.
The runner reports this naming mismatch without printing the credential or silently loading another source.

```sh
export TYPESAFE_API_KEY="${TYPESAFE_API_KEY:-${jev:-}}"
```

Large generated JSONL partitions, reference-row JSON, extracted page text, and result artifacts omit textual Git diffs through local `.gitattributes` rules.
Their ordinary files remain readable with any JSON/JSONL tool; review the generator, explicit curation, independently entered PDF checks, checksum manifest, and human case list together.

For the measured seed extension, use `--cases=measured/dev-selection.json` with `--split=dev --tier=both`.
The frozen selection includes new dev cases and original dev matching cases whose candidate metadata changed.
The collector reuses exact canonical requests only when the raw exchange, current required model, typed response and settled billing agree.
Reuse receipts identify the original run/request and incur no reservation or charge.
Missing exchange evidence refuses recollection.
A Haiku original-format failure may receive one changed probability-instruction payload; identical paid payloads and successful original requests always reuse cache.
Do not delete historical exchanges while their paid inputs remain eligible for replay.

## Paid model adapters

`haiku` uses the repository's production alias `claude-haiku-4-5` on Anthropic; `qwen` uses the spike's `qwen/qwen3-235b-a22b-2507` on OpenRouter.
They reuse Jev's exact question instructions, input projections, choice probabilities, bin definitions, conditional refinement and final decoder.
Their transport serializes the same `state` and `questions` into one user message with a JSON answer schema, temperature zero and at most 1,536 output tokens.
Haiku adds a provider-specific system instruction requiring each probability vector to total exactly one and its choice to equal argmax.
The Jev questions, input state, schema, bins and strict decoder remain unchanged.
Qwen retains its original payload.
Model-specific chat serialization and constrained generation are transport differences from Jev and remain a comparison limitation.
Both methods are dev-only; their presence forces Jev onto a client with no credential and no network transport.
A Jev cache miss fails visibly rather than making another paid call.

Both providers append tagged reservations and settlements to the existing `results/spend.jsonl`, under the existing `.jev.lock`.
The $2.70 stop sits inside the $3 hard cap across the cumulative suite ledger, including historical Jev, prior invocations and billed failures.
Unknown usage or an unfinished reservation blocks new calls to either provider.
Each request reserves input at one token per serialized UTF-8 byte plus 1,024 tokens of overhead and the complete output limit before sending.
The runner reserves both stages of every macro case and both selected providers before sampling.
When full dev exceeds that conservative envelope, it samples both tiers deterministically by tier/task/chain/category and applies identical case IDs to every compared method.
The run metadata retains full/selected upper bounds, selected IDs and their hash.
Sampling is intentionally conservative and may leave substantial money unspent.
For a continuation, freeze the original ordered IDs in a source selection file and pass `--cases=<file>.json`.
An explicit paid-model selection must fit in full; it is never silently resampled.
The durable model replay validates original payloads, model identity, usage and settled bills, and deducts already-paid requests from the remaining reservation.
Known billed invalid answers remain failures under the strict decoder, while other cases continue.
Only original Haiku format failures are eligible for the changed probability instruction; current-payload failures remain terminal cached outcomes.
Unknown billing, missing paid evidence, unexpected models, reservation overruns and transport failures still stop collection.

`--replay-only` also supports Haiku and Qwen with no credential, HTTP transport, reservation or ledger mutation.
It re-parses the retained completed bodies with the same strict Jev decoder instead of trusting an old case-level failure label.
Invalid JSON, invalid typed fields/probability distributions, incomplete output and reconciled timeouts retain distinct failure diagnostics.
Probability totals and argmax validation are never relaxed or normalized for one provider.
A byte-identical billed payload remains cached and cannot be bought again.
Reports show parse/format failures, timeouts, abstentions and missing results separately, with both parsed-only macro metrics and the original all-case penalties.
Parsed-only metrics exclude every case without a valid macro prediction; exact matching has no macro estimator.
Anthropic's documented schema-compilation HTTP 400 rejection happens before inference and is recorded as a zero-cost transport failure, stopping the run for repair.
For an older runner that recorded that exact rejection as unknown usage, `reconcileRejection` appends a zero-cost receipt bound to the retained response hash; other missing usage stays unknown.
The ledger reader revalidates that original HTTP 400 response on every subsequent admission.
Macro output schemas reuse equivalent answer definitions with `$ref` to stay within the provider's compiled-grammar limits; all choice/probability requirements and downstream validation remain intact.
Qwen is pinned to OpenRouter's `deepinfra/fp8` endpoint at the same price ceiling, with fallbacks disabled, after the advertised GMICloud endpoint rejected the model as deprecated.
A GMICloud deprecation HTTP 400 remains unknown until `reconcileRejection` also validates a retained same-day zero-usage read from the authorized key's `GET /api/v1/key` response.
That sanitized usage receipt contains no key, label or user identifier, and its hash is rechecked during every later ledger admission.
Qwen's body deadline is 300 seconds after measured 60- and 180-second timeouts on the slow endpoint; the token ceiling and price reservation are unchanged.
When the provider supplies a generation ID in response headers, it is journaled before reading the body so a lost body retains that billing lookup identity.
For the original lost-ID timeout, `reconcileQwenTimeout` accepts exactly one unresolved reservation and stable same-key usage counters from the isolated run window.
It requires a zero daily baseline, matching lifetime/daily deltas, two stable post-timeout reads at least 30 seconds apart, and a delta within the complete reserved envelope.
The charge is explicitly allocated from aggregate provider usage, rather than fabricated token counts; the original missing response remains a failed case and can never be paid for again.
Other unknown usage remains blocked, and later ledger admissions revalidate every retained proof hash.
When a header generation ID is available, `reconcileQwenTimeout` instead requires its exact completed/cancelled `GET /api/v1/generation` record, matching model/provider/time, native token bounds and reserved cost.
That exact-generation proof takes precedence over aggregate counter allocation, and the lost output still remains failed.
Haiku cost uses returned token counts at $1/M input and $5/M output; Qwen uses returned `usage.cost` with routing price ceilings of $0.09/M input and $0.55/M output, checked October 26, 2026.

No env file is sourced or auto-loaded by the runner.
Only explicitly authorized credential keys may enter the child process environment; never copy secrets into result files or connect to a database for this suite.
For the follow-up October 26 run, the human explicitly approved shell sourcing of `~/Desktop/secrets.env` into the invoking process.
That file uses legacy `anthropic` and `openrouter` names, mapped in memory with the following authorized invocation.

```sh
set +x
set -a
source "$HOME/Desktop/secrets.env"
set +a
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-${anthropic:-}}"
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-${openrouter:-}}"
# Check presence by name only; never print values or the whole environment.
```

Without explicit shell-sourcing approval, select authorized keys using a dotenv parser.
The actual four-method entrypoint lists every missing key and any recognized legacy name before any request or reservation, so an unavailable provider is never silently substituted.
Other connected tools have no relevant credential source; unrelated hosting environments and all `~/fitsy-refactor` paths are excluded.
An unavailable live run remains unavailable; offline fixtures prove adapter mechanics, not model quality or live API acceptance.

## Haiku format recovery

The strict result remains primary.
`haiku-format.ts <baseline-run-id>` diagnoses cached failed distributions and produces a separate secondary normalized view, without credentials or transport.
Normalization divides each vector by its positive sum and selects exact argmax; invalid shapes and zero totals remain failures.
If normalization changes a coarse choice whose refinement is absent, the case fails explicitly rather than fetching it.

The generated `sources/haiku-format-failed-dev.json` selects only the 30 failed Haiku macro cases and three matching failures in the original 129-case DEV sample.
Commit all executing source and selection inputs before collection.
Use the existing runner with `--methods=haiku --split=dev --tier=both --cases=haiku-format-failed-dev.json --live`.
Source the authorized lowercase `anthropic` variable in the detached shell and export it as `ANTHROPIC_API_KEY` in process memory only.
Never print or copy credential values into evidence.
Use a detached session with stdout/stderr redirected to task-owned files so disconnects do not restart collection.
The existing exclusive lock, durable per-request reservation and $2.70 cumulative stop apply before every request.
Re-running the command consumes successful original stages and all current-payload attempts from cache, including current failures.
A complete four-method `--replay-only` run on `haiku-qwen-dev-sample.json` supplies the final strict rescore.
The comparison audit uses actual serialized payload hashes for no-repeat proof and preserves the entire starting ledger prefix.
