# Lens: test-quality

Runs when a PR touches `*.test.*` files. One concern: **do these tests
actually pin behavior, or do they pass vacuously?** Agent-written tests are
the known weak spot (T5). Read `REVIEW.md` first.

## Look for

- Assertion-free or tautological tests: no `expect`, `expect(x).toBe(x)`,
  snapshot-everything, or asserting only that a mock was called with what the
  test itself passed in.
- Tests that mock our own code (`lib/`, `app/`) - the own-code-mocks check
  counts them; you judge whether this PR's additions deepen the debt or could
  use `tests/db/` instead.
- A behavior change in the same PR whose test would still pass WITHOUT the
  code change - name the assertion that should fail on the old code.
- Deleted or weakened assertions ("temporarily" skipped tests, widened
  tolerances, `toBeTruthy` replacing an exact value) with no explanation.
- Mutation-surviving shapes: branches with no test on the false path,
  error paths asserted only as "does not throw".

## Examples from real incidents

- File-wide mock leaking across describes: `jest.mock` at module scope left a
  `mockResolvedValue(8)` active inside the "real DB" describe, so the suite
  asserted against the mock - and had NEVER actually run (its env gate was
  never satisfied in CI). Tell: one file mixing mocked-unit and real-DB
  describes without restoring implementations; a DB describe whose env gate
  no CI job satisfies. (#234)

## Inputs

When a Stryker report exists in `.evidence/mutation/`, surviving mutants on
lines this PR touched are findings; cite mutant and line.
