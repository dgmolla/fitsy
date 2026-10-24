# Review impact and disposition

The canonical lens runner keeps the independent review JSON unchanged.
`severity` records confidence, `priority` records user impact, and `verdict` remains `fail` when any finding is `CONFIRMED`.
`run-review.sh` evaluates a separate disposition file before setting its effective gate result and commit status.
A failed raw verdict remains visible when an owned P2 follow-up satisfies the gate or its confirmed findings are P3 advisory.
Reviewer execution failure, timeout, authentication failure or invalid output produces `verdict: "incomplete"`, `findings: []` and an `error.kind` of `execution_error` or `invalid_output`.
An incomplete review has no product priority, cannot be disposed, is never cached and fails the gate even for an advisory lens.
Its PR commit status is `error`, while a completed review with a blocking code finding reports `failure`.
The active local AI review poller allows two attempts per head SHA; incomplete execution never passes.
Historical `(runner)` findings remain blocking if encountered in earlier review records.
This review gate does not replace `npm run verify`, product-flow evidence, source identity or release approval.

## Priority and supported dispositions

| Priority | Meaning | Supported disposition | Gate |
| --- | --- | --- | --- |
| P0 | Critical material impact | `block` | Fail |
| P1 | High material impact | `block` | Fail |
| P2 | Medium impact | `defer` with owner, acceptance and current required tests | Pass |
| P3 | Low impact | Advisory, raw finding retained | Pass |

The urgency rubric in `REVIEW.md` owns priority calibration across production impact, blast radius, likelihood, recovery, code quality and release relevance.
A reviewer must explain user outcome, realistic trigger, scope, evidence and violated contract in each finding's `impact` string.
The adjudication repeats those five facts as separate fields.
An absent or mismatched priority, missing P2 disposition, unowned follow-up, invalid required test or stale identity fails closed.
Confirmed P0/P1 block without needing a disposition file, including findings from an otherwise advisory lens.
Required tests and essential acceptance remain independent gates even when a review finding is deferred or advisory.
A plausible P0 or P1 gets bounded investigation; if the impact is confirmed, the resulting P0 or P1 blocks.
This contract allows no automatic dismissal or silent priority downgrade.
If evidence changes the priority, obtain a new independent verdict and record the reasoning outside the raw review.

The disposition file is `.evidence/review-dispositions/<lens>.json` by default, or `<FITSY_REVIEW_DISPOSITIONS_DIR>/<lens>.json` when explicitly configured.
It stays separate from the raw review and is bound to the reviewed source SHA, diff SHA-256, raw review SHA-256 and each finding SHA-256.
The runner prints the first three values in its `gate` line after an initial review.
Each `finding_sha256` is the SHA-256 of that finding serialized as compact JSON with sorted keys.
Changing source, diff, reviewer output or a test receipt requires a new disposition.
Old cached verdicts cannot silently pass: `REVIEW.md`, parser, gate and runner scripts are part of the raw cache key, and the effective gate is recomputed on every cache hit.

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
The sidecar must have exactly one entry for every confirmed P2 finding, in review order, using its original finding index.
Existing source-bound P3 entries may remain as history, but new P3 findings need no blocking paperwork.
Plausible and nit findings remain comments and need no disposition.
For a P0 or P1 entry, set `disposition: "block"` and provide the five impact fields; the gate still fails.

## Review attempts and historical evidence

The local AI review poller owns the two-attempt limit per head SHA and publishes the `AI review` commit status.
A new head SHA has its own attempt allowance.
Workflow and provider timeouts bound individual execution.
The repository no longer maintains a cumulative review ledger, execution reservations, allocation grants or completed-review accounting commands.
Do not start the retired poller alongside the active AI review poller.

Preserve existing historical ledgers, completed manifests and raw provider artifacts needed by unfinished tasks.
Remaining historical evidence consumers may verify those records without allocating new review time or rewriting history.
An exhausted or incomplete attempt never supplies a passing review, replaces Verify or waives product and release requirements.

## Jev advisory experiment

[Issue #372](https://github.com/dgmolla/fitsy/issues/372) owns the review-triage experiment and remains queued after delivery work.
It is separate from the simulator/Maestro evaluation in issue #345.
This policy records the experiment contract only; it enables no vendor integration or transmission.

A shadow evaluator may recommend `fix`, `defer`, `investigate`, or `unsupported` with evidence and uncertainty.
`Unsupported` means the evaluator could not substantiate a claim; it does not dismiss the independent finding.
Jev may not change the raw review, impact priority, effective gate, required tests, acceptance, or merge authority.
A named independent adjudicator decides the correct disposition without using Jev's answer as authority.
Compare recommendations against that adjudication, including false-dismiss recommendations on confirmed high-impact findings, overall disagreement, false blockers, actual cost and elapsed latency.
Define the sample, high-impact cases and success thresholds before running the experiment; preserve unfavorable results and compare against the existing process.
Any high-impact false dismissal must be investigated before considering a change in authority.
External data sharing and any later gate integration require separate explicit authorization and independently reviewed work.

## Adoption

Follow [the current review runner guide](../../../scripts/review/simple-review.md) for reviewer isolation, severity handling and the single PR comment.
Run `node --test scripts/review/simple-review.test.mjs` for the retained review behavior tests.
The local AI review poller publishes the current head's `AI review` status; Verify and applicable product, deployment and migration checks remain independent requirements.

Historical review findings and source-bound deferrals remain in [issue #330](https://github.com/dgmolla/fitsy/issues/330) and their original evidence.
Retiring the ledger does not turn an old failed verdict into a pass.
