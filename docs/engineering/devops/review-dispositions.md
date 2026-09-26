# Review impact and disposition

The canonical lens runner keeps the independent review JSON unchanged.
`severity` records confidence, `priority` records user impact, and `verdict` remains `fail` when any finding is `CONFIRMED`.
`run-lens.sh` evaluates a separate disposition file before setting its effective gate result and commit status.
A failed raw verdict can therefore remain visible when an owned P2 or P3 follow-up satisfies the gate.
Reviewer execution failure, timeout, authentication failure or invalid output produces `verdict: "incomplete"`, `findings: []` and an `error.kind` of `execution_error` or `invalid_output`.
An incomplete review has no product priority, cannot be disposed, is never cached and fails the gate even for an advisory lens.
Its PR commit status is `error`, while a completed review with a blocking code finding reports `failure`.
The poller treats the latest `error` as incomplete and may retry it within the existing review budget.
Historical `(runner)` findings remain blocking if encountered in earlier review records.
This review gate does not replace `npm run verify`, product-flow evidence, source identity or release approval.

## Priority and supported dispositions

| Priority | Meaning | Supported disposition | Gate |
| --- | --- | --- | --- |
| P0 | Critical material impact | `block` | Fail |
| P1 | High material impact | `block` | Fail |
| P2 | Medium impact | `defer` with owner, acceptance and current required tests | Pass |
| P3 | Low impact | `defer` with owner, acceptance and current required tests | Pass |

A reviewer must explain user outcome, realistic trigger, scope, evidence and violated contract in each finding's `impact` string.
The adjudication repeats those five facts as separate fields.
An absent or mismatched priority, missing disposition, unowned follow-up, invalid test or stale identity fails closed.
A plausible P0 or P1 gets bounded investigation; if the impact is confirmed, the resulting P0 or P1 blocks.
This first slice deliberately supports no dismissal or silent priority downgrade.
If evidence changes the priority, obtain a new independent verdict and record the reasoning outside the raw review.

The disposition file is `.evidence/review-dispositions/<lens>.json` by default, or `<FITSY_REVIEW_DISPOSITIONS_DIR>/<lens>.json` when explicitly configured.
It stays separate from the raw review and is bound to the reviewed source SHA, diff SHA-256, raw review SHA-256 and each finding SHA-256.
The runner prints the first three values in its `gate` line after an initial review.
Each `finding_sha256` is the SHA-256 of that finding serialized as compact JSON with sorted keys.
Changing source, diff, reviewer output or a test receipt requires a new disposition.
Old cached verdicts cannot silently pass: `REVIEW.md`, parser, gate and budget scripts are part of the raw cache key, and the effective gate is recomputed on every cache hit.

A version 1 file has this shape:

```json
{
  "version": 1,
  "lens": "correctness",
  "source_sha": "<reviewed commit>",
  "diff_sha256": "<runner gate identity>",
  "review_sha256": "<runner gate identity>",
  "findings": [{
    "index": 0,
    "finding_sha256": "<canonical finding hash>",
    "priority": "P2",
    "disposition": "defer",
    "impact": {
      "user_outcome": "No-video proof starts",
      "trigger": "Historical movie plus unavailable optional probe",
      "scope": "Native test runs on hosts without the probe",
      "evidence": "Saved reproduction and positive control",
      "contract": "The no-video runbook makes recording tools optional"
    },
    "owner": "Named follow-up owner",
    "acceptance": "Historical movie remains intact and the no-video pre-flow snapshot completes",
    "required_tests": [{
      "id": "verify",
      "receipt": ".evidence/review-tests/verify.json",
      "sha256": "<SHA-256 of receipt bytes>"
    }]
  }]
}
```

A required test receipt is JSON with `id`, `source_sha`, `command`, `result: "pass"`, `exit_code: 0` and `finished_at`.
Its path must resolve beneath this checkout's `.evidence` directory, and its bytes must match the disposition hash.
Record an actual completed test command and its result; a receipt is an audit pointer, not permission to skip the underlying canonical gate.
The sidecar must have exactly one entry for every confirmed raw finding, in review order, using its original finding index.
Plausible and nit findings remain comments and need no disposition.
For a P0 or P1 entry, set `disposition: "block"` and provide the five impact fields; the gate still fails.

## Review budget

The runner records new independent review executions in an append-only JSONL file at `.evidence/review-budget.jsonl` by default.
Set `FITSY_REVIEW_BUDGET_LEDGER` to one durable candidate-specific path and retain it across local and PR review commands.
The poller keeps a separate ledger per PR under its review home.
A source SHA is one round, with all required lenses on that SHA sharing the round.
A new reviewer execution stops before launch after two distinct reviewed heads or 30 minutes of measured review execution, whichever occurs first.
Cached raw verdicts can be reevaluated without spending another round.
Finish active checks safely at the cap and consolidate findings instead of launching broad new reviews.

A named exception is available only for a concrete P0 or P1 repair.
Set `FITSY_REVIEW_EXCEPTION` to a JSON file with `version: 1`, `priority: "P0"` or `"P1"`, `lens`, `source_sha`, `finding`, `realistic_impact`, `evidence`, `repair`, `exit_condition`, `owner` and a positive `budget_seconds` no greater than 1800.
The runner admits only that lens and source while the cumulative exception time remains within its budget.
An exception does not convert the P0/P1 gate to success or waive required validation.

## Adoption

Run `npm run verify` and applicable local lenses on the committed branch with `FITSY_REVIEW_PROVIDER` and `FITSY_REVIEW_MODEL` set to authenticated independent review settings.
Keep the raw JSON emitted by `run-lens.sh` and the initial `gate` identity line.
For a P2/P3 finding, record the owner, acceptance criteria and actual required-test receipts in the sidecar, then rerun the same lens.
A valid raw cache hit reuses the independent reviewer while the gate evaluates the new disposition.
For a ready PR, run the same canonical runner in PR mode with `FITSY_GH_BIN=gh-axi` and the same candidate budget and disposition paths, then read back the exact-head statuses.
The PR comment and status description expose raw findings and the effective gate separately.
Publish `product-flow/local` for a mobile-facing PR; a non-product PR uses the canonical not-applicable selection.
Merge and deployment remain with the configured authority.

The saved review 58 remains failed and belongs to the paused worker's commit.
This slice does not repair that P2, launch another review for that candidate or adopt its unmerged implementation.
The larger one-hour shipping claim requires three comparable end-to-end deliveries and is still unproven.
