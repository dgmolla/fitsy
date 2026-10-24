# Simple review

`scripts/review/simple-review.mjs` is the supported review runner.
The `Simple review` workflow runs its dependency-free behavior tests for same-repository pull requests.
The owner's installed local reviewer supplies the `AI review` commit status using the Codex subscription.
Removing the retired repository poller does not change that status or GitHub merge requirements.

The runner imports only Node built-ins.
Its repository inputs are `scripts/route-reviewers.sh`, `REVIEW.md` and the selected `.claude/lenses/*.md` files.
Correctness always runs.
The router maps API/mobile roles to danger-zone, CTO to workflow-security, product-manager to spec-conformance, and design/GTM to docs-sanity.
There are no review caches, approval fingerprints, P2 disposition files or retained review ledgers in this runner.

The caller must load the runner, router and review guidance from the immutable trusted base and check out the exact PR head.
The runner verifies that checkout, reviews the merge-base diff and rechecks the live PR before publishing.
Forks and the `skip-review` label skip execution.
The CLI entrypoint consumes `GITHUB_EVENT_PATH`, `GITHUB_EVENT_NAME=pull_request` and `GITHUB_REPOSITORY`.
Its GitHub transport requires `GH_TOKEN`; its Codex API adapter requires `CODEX_API_KEY`.
The installed subscription caller uses the exported routing and validation functions with its local provider transport.

The current provider adapter supports Codex only and rejects unsupported providers without fallback.
It runs once in a temporary home with a read-only sandbox and receives no GitHub token or inherited agent session.
It defaults to `gpt-6-sol` with high reasoning effort; `FITSY_REVIEW_MODEL` can select another supported model.
The CLI uses the documented [non-interactive mode](https://developers.openai.com/codex/noninteractive/).

Each completed runner invocation creates or updates one marked GitHub Actions bot comment, retaining all findings and the raw verdict.
Exit 1 means at least one CONFIRMED P0/P1 finding; all other confidence/priority combinations are advisory.
Exit 2 means execution, output validation, freshness or publication failed, so no passing review was established.
Malformed output, missing domains, provider failures and timeouts cannot be interpreted as approval.

Run the suite with `node --test scripts/review/simple-review.test.mjs`.
It exercises real temporary Git repositories and the actual runner, substituting only the external provider CLI and GitHub transport.
It covers severity, complete domain coverage, stale publication, one-comment updates, provider isolation and cleanup of the temporary home.
