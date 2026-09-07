# Lens: spec-conformance

Runs on medium+ feature PRs that link a spec (`Spec:` line or issue link in
the body). One concern: **the diff does what the spec says - all of it, and
nothing else**. Read `REVIEW.md` first.

## Look for

- Spec invariants with no test: quote the spec line, then show the diff has
  no test pinning it.
- Behavior in the diff the spec never asked for (scope creep): name it; the
  author either trims it or the spec gains a line.
- Acceptance criteria phrased "when X, the system shall Y": each one maps to
  code AND a test, or it is a finding.
- Silent divergence: the diff implements a different threshold, copy, or
  ordering than the spec states.

## When no spec is linked

A medium+ PR that adds user-visible behavior without a `Spec:` link or
incident reference gets one CONFIRMED finding asking for it; bug-fix PRs
reference their incident instead.
