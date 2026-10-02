# Review impact and disposition

The canonical lens runner keeps the independent review JSON unchanged.
`severity` records confidence, `priority` records user impact, and `verdict` remains `fail` when any finding is `CONFIRMED`.
`run-review.sh` evaluates a separate disposition file before setting its effective gate result and commit status.
A failed raw verdict remains visible when an owned P2 follow-up satisfies the gate or its confirmed findings are P3 advisory.
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
The sidecar must have exactly one entry for every confirmed P2 finding, in review order, using its original finding index.
Existing source-bound P3 entries may remain as history, but new P3 findings need no blocking paperwork.
Plausible and nit findings remain comments and need no disposition.
For a P0 or P1 entry, set `disposition: "block"` and provide the five impact fields; the gate still fails.

## Review budget

The runner allows at most 1,800 seconds of cumulative independent reviewer execution for one delivery issue across every source head, lens, provider, local invocation and PR invocation.
There is no source-round limit.
Successful, failed, invalid-output, interrupted and timed-out executions all consume time; a retry, rebase, changed head, worker restart or provider change does not reset history.
A valid cached verdict spends no new reviewer time and retains its original execution provenance.

Local mode uses the existing delivery issue binding; PR mode requires exactly one `Delivery-Issue: #N` field.
Both use `~/.cache/fitsy-review/budgets/issue-N.jsonl` by default, including the poller.
A locked binding under that budget directory ties the repository root ancestry and candidate branch name to its original issue across clones and later heads.
Keep one delivery issue per candidate branch; changing the PR issue field cannot allocate a fresh pool.
Read the full PR body for the unique issue field before limiting metadata in the review prompt.
`FITSY_REVIEW_BUDGET_HOME` may select a shared durable location, but every caller for that issue must use the same location.
The append-only ledger imports the checkout's historical `.evidence/review-budget.jsonl`, any explicit `FITSY_REVIEW_BUDGET_LEDGER` or `FITSY_REVIEW_BUDGET_IMPORT_LEDGER`, and in PR mode the historical `${FITSY_REVIEW_HOME:-$HOME/.fitsy-review}/budgets/PR_NUMBER.jsonl`.
Those originals remain unchanged; imported events retain their original exception, adoption and closeout flags and elapsed time.
Copies of the same events count once, while conflicting copies fail closed.
The old exception/adoption/closeout permits do not extend the cumulative cap.
Do not point a resumed candidate at an empty budget location or omit known prior ledgers.

Before reviewer launch, a file lock atomically reserves its granted timeout plus five seconds for process closeout.
The grant is no larger than the requested timeout or the remaining unreserved capacity.
The adapter receives that exact deadline and records it in the verdict's execution identity.
A completed verdict's cache key binds content, provider, model, CLI, security policy and executor definition; changing remaining time alone does not invalidate it.
Concurrent lenses cannot each spend the same remaining capacity.
The caller waits for reviewer termination before recording elapsed execution and releasing unused reserved time.
An unfinished new attempt retains its full reservation; a legacy unfinished attempt with no bounded reservation refuses new execution until its actual completion is reconciled.
Never manufacture a finish time or a pass to release capacity.

Inspect and migrate history before resuming an older candidate:

```sh
python3 scripts/review/review-budget.py status \
  --ledger "$HOME/.cache/fitsy-review/budgets/issue-N.jsonl" \
  --import-ledger /absolute/path/to/prior/.evidence/review-budget.jsonl
```

Repeat `--import-ledger` for every known candidate ledger, including prior explicit exceptions or poller histories.
The response reports completed, reserved and remaining seconds plus unfinished attempts.
At exhaustion, retain the findings and evidence and stop new reviewer execution.
Consolidate confirmed blockers and owned deferrals under the existing gate; time exhaustion is not approval, a passing review, or permission to waive required tests.
Any later authorized policy exception must retain the complete history and name its actual remaining boundary; the runner provides no unlimited reset switch.

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

Run `npm run verify` and applicable local lenses on the committed branch with `FITSY_REVIEW_PROVIDER` and `FITSY_REVIEW_MODEL` set to authenticated independent review settings.
Keep the raw JSON emitted by `run-review.sh` and the initial `gate` identity line.
For a P2 finding, record the owner, acceptance criteria and actual required-test receipts in the sidecar, then rerun the same lens.
A valid raw cache hit reuses the independent reviewer while the gate evaluates the new disposition.
For a ready PR, run the same canonical runner in PR mode with `FITSY_GH_BIN=gh-axi` and the same candidate budget directory and disposition paths, then read back the exact-head statuses.
The PR comment and status description expose raw findings and the effective gate separately.
Publish `product-flow/local` for a mobile-facing PR; a non-product PR uses the canonical not-applicable selection.
Merge and deployment remain with the configured authority.

Historical review findings and source-bound deferrals remain in [issue #330](https://github.com/dgmolla/fitsy/issues/330) and their original evidence.
Changing the time policy does not turn an old failed verdict into a pass or prove a delivery-speed target.


### Execution recovery and explicit authorization

Per-attempt wall time, cumulative reviewer execution and delivery-worker lifetime are separate constraints.
The default independent attempt is 900 seconds; one classified timeout/transient retry on the same head may double that deadline, capped at 3600 seconds and the remaining reserved issue allowance.
A later poller tick supplies backoff; authentication, configuration, invalid output and unknown failures receive no blind automatic retry.
Private per-attempt execution receipts retain stdout/stderr, failure kind, elapsed seconds and observed stream activity.
Stream activity is transport evidence, not semantic progress or a verdict; repeated output never grants more time inside an attempt.
A hard deadline still kills the process group and rejects any partial pass.

One issue-wide infrastructure recovery extension supplies 1800 seconds after the ordinary 900-second extension is used, only for a retained failed same-head/lens timeout or transient provider error.
The ordinary maximum is 4500 cumulative seconds across all heads and lenses, with atomic reservations and all failed cost retained.
Human-authorized grants retain their separate explicit ceiling and suppress automatic recovery expansion.

To avoid editing review-control code for each approval, a trusted coordinator may use `python3 -I /absolute/trusted/review-budget.py grant-authorized --authorization-file /absolute/private/approval.json` with the original issue ledger, candidate and issue arguments.
Use the independently reviewed, committed operator installation from the trusted main branch, never the candidate checkout or its Python import files.
Confirm that installation supports the authorization command before invoking it; an older installation requires deliberate trusted installation, not execution from an unreviewed branch.
The owner-controlled, non-group-writable manifest must live outside the reviewed checkout and contain exactly `issue`, `seconds` and the GitHub issue-comment `provenance` of explicit human approval.
The coordinator must verify that approval before creating the manifest; a URL alone is not evidence of approval.
The runner records its hash, retains prior grants, rejects duplicate provenance and active unreconciled attempts, and limits cumulative explicitly granted additions to 14400 seconds.
This operator ceiling is finite and separate from ordinary automatic capacity; it is not an unlimited reset switch.
Historical finite authorized-grant events remain readable without issue-specific code.

Recommended worker policy: allow a three-hour default delivery window for native build/review/E2E work, with a bounded extension to four hours when the recorded owner has concrete recent phase progress.
Idle heartbeats, log noise and a still-existing process do not establish that progress.
This recommendation does not change dispatcher worker scheduling in this patch.
