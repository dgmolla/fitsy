# Lens: docs-sanity

One concern: **docs that lie**. Runs on tier-low (docs/bookkeeping) PRs. Comment-only: this lens never blocks, so its verdict is always `pass`; findings are posted for the author.
Read `REVIEW.md` first.

## Look for

- Claims that contradict the repo: commands that do not exist in `package.json`/`scripts/`, paths that do not exist, knob values not in the tuning guide.
- Stale cross-references: a doc pointing at a file this or a recent PR moved or renamed.
- Contradictions between the changed doc and `CLAUDE.md` or `docs/engineering/devops/autonomous-shipping.md` (one of them must be wrong — say which).
- A spec or design doc without a Mermaid diagram of the primary flow (repo convention).
- Docs placed outside their domain directory (`docs/{product,engineering,design,gtm}`).

## Do not

- Comment on tone, wording, or formatting choices.
- Review the substance of GTM/product strategy; only factual consistency with the repo.
