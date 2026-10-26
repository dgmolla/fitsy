**TL;DR:** Run offline exact matching or explicit bounded Jev matching and estimation against dev fixtures.

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
# Source the user-authorized key in the invoking shell; never print it.
npm run eval:suite -w scripts -- --methods=exact,jev-v3 --split=dev --tier=both --live

npm run lint:suite -w scripts
npm run type-check -w scripts
npm test -w scripts -- --runInBand --runTestsByPath eval/suite/suite.test.ts

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

Large generated JSONL partitions, reference-row JSON, extracted page text, and result artifacts omit textual Git diffs through local `.gitattributes` rules.
Their ordinary files remain readable with any JSON/JSONL tool; review the generator, explicit curation, independently entered PDF checks, checksum manifest, and human case list together.
