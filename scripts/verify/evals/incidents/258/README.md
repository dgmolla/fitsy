# Incident 258: dev migration ordering

[Dev maintenance run 34760050587](https://github.com/dgmolla/fitsy/actions/runs/34760050587) failed at the drift check with `comm: file 2 is not in sorted order`.
The same unmodified CLI reproduced that failure under GNU coreutils against DEV, using only its SELECT queries.

PostgreSQL's migration ordering need not match the shell's ordering.
The fix sorts both sets under the same C locale before comparison.
A failed migration or seed-count read remains a distinct failure, and the success count reports migrations rather than string length.
The scheduled workflow requires a completed pass; a missing tool or skipped check cannot certify dev health.

The registered scripts test suite discovers `verify/dev-drift.test.ts`.
The original unordered-migration detector failed before the fix and passes afterward.
All nine current regression cases pass, including failed migration reads, a dropped seed-query connection, missing migrations, scheduled pass/fail/skip handling and retention of early workspace errors for two failure exit codes.
The corrected real CLI against DEV passed with 34 migrations, 550 restaurants, 38,938 menu rows and three seed users.

Constraint: local sorting removes dependence on database return order, the explicit C locale pins shell ordering, and guarded database reads cannot turn a connection failure into a skipped check.
The scheduled workflow accepts only exit zero.
The executable tests also exercise the actual shell and workflow step instead of duplicating a status rule.
The reverse diff is the retained bad-state replay for the correctness lens.

A separate API failure in main Verify run 34760469417 exposed truncated diagnostics: later passing mobile output erased the earlier API failure.
The runner now retains full failed-check stderr within its existing buffer limit and emits it through normal CI logs.
No new artifact upload or permissions are introduced.
This restores diagnostics but does not establish the root cause of that API failure; its two local replays passed, and investigation remains open.
