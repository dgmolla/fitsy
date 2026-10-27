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
npm run eval:suite -w scripts -- --methods=exact,jev-v3,haiku,qwen --split=dev --tier=both --live

# Recover a dev baseline without credentials or any paid transport.
npm run eval:suite -w scripts -- --methods=exact,jev-v3 --split=dev --tier=both --live --replay-only

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
`results/spend.jsonl` is the additive cumulative suite-wide spending history.
It is never reset between commands or split/tier selections.
`.jev.lock` enforces one live collection at a time.
After an interrupted process, verify the recorded PID has ended before removing only its stale lock.
A pending reservation or unknown usage still blocks collection until actual billing is reconciled with human review; removing a lock never clears that history.

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
Reuse receipts identify the original run/request and incur no reservation or charge; missing exchange evidence or a previously billed failed request refuses recollection.
Do not delete historical exchanges while their paid inputs remain eligible for replay.

## Paid model adapters

`haiku` uses the repository's production alias `claude-haiku-4-5` on Anthropic; `qwen` uses the spike's `qwen/qwen3-235b-a22b-2507` on OpenRouter.
They reuse Jev's exact question instructions, input projections, choice probabilities, bin definitions, conditional refinement and final decoder.
Their transport serializes the same `state` and `questions` into one user message with a JSON answer schema, temperature zero and at most 1,536 output tokens.
No calibration, free-form macro prompt, reasoning request, tool, web search or retry is added.
Model-specific chat serialization and constrained generation are transport differences from Jev and remain a comparison limitation.
Both methods are dev-only; their presence forces Jev onto a client with no credential and no network transport.
A Jev cache miss fails visibly rather than making another paid call.

Both providers append tagged reservations and settlements to the existing `results/spend.jsonl`, under the existing `.jev.lock`.
The $2.70 stop sits inside the $3 hard cap across all Haiku/Qwen calls, including prior invocations and billed failures; old Jev spend is retained separately in the cumulative total.
Unknown usage or an unfinished reservation blocks new calls to either provider.
Each request reserves input at one token per serialized UTF-8 byte plus 1,024 tokens of overhead and the complete output limit before sending.
The runner reserves both stages of every macro case and both selected providers before sampling.
When full dev exceeds that conservative envelope, it samples both tiers deterministically by tier/task/chain/category and applies identical case IDs to every compared method.
The run metadata retains full/selected upper bounds, selected IDs and their hash.
Sampling is intentionally conservative and may leave substantial money unspent.
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
