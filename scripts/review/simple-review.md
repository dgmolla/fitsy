# Parallel simple review

The `Simple review` workflow runs alongside the existing review system and does not replace its required checks.
It uses `pull_request` events for same-repository branches, skips forks and the `skip-review` label, and cancels superseded runs per PR.
There is no attempt counter or retained review ledger.

Reviews run on the owner's Mac: a launchd poller calls `codex exec --sandbox read-only` with the local Codex subscription (model `gpt-6.1-sol`), reusing `selectLenses`/`validateReview` from this file, posts the review comment and sets the `AI review` commit status (success unless a CONFIRMED P0/P1). No GitHub secret is needed; the CI `review` job is removed.
The current provider adapter supports the Codex CLI only and rejects unsupported providers without fallback.
It runs once in a temporary home with a read-only sandbox and receives no GitHub token or inherited agent session.
The CLI uses the documented [non-interactive mode](https://developers.openai.com/codex/noninteractive/).
The router maps API/mobile roles to danger-zone, CTO to workflow-security, product-manager to spec-conformance, and design/GTM to docs-sanity; correctness always runs.

The workflow executes the runner, router, REVIEW.md and lenses from the event's immutable base commit against the exact PR head checkout and merge-base diff.
The installation PR cannot review itself using trusted base controls until those files have landed on the base branch; its existing review system remains authoritative during installation.
Use `skip-review` on that installation PR while retaining the old review gate.
Do not make this new check required until the base contains the runner, the secret is configured, and a subsequent same-repository PR demonstrates a live review.

Each completed run creates or updates one marked GitHub Actions bot comment, retaining all findings and the raw verdict.
Exit 1 means at least one CONFIRMED P0/P1 finding; all other confidence/priority combinations are advisory.
Exit 2 means execution, output validation, freshness or publication failed, so no passing review was established.
Malformed output, missing domains, provider failures and timeouts cannot be interpreted as approval.
The runner rechecks live commits and labels before publishing; concurrency cancellation replaces attempt limits.

Run the small dependency-free suite with `node --test scripts/review/simple-review.test.mjs`.
It exercises real temporary Git repositories and the actual runner, substituting only the external provider CLI and GitHub transport.
