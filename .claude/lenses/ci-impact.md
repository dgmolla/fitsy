# Lens: ci-impact

Runs when a PR touches `.github/**`, `vercel.json`, `eas.json`,
`scripts/deploy/**`, `scripts/verify/**`, or `scripts/sim/**`. Two concerns,
both about the CI/CD surface itself rather than product code: (1) **it stays
least-privilege and injection-proof** (tenet T12), and (2) **it doesn't
quietly change what CI catches or lets pass**. Read `REVIEW.md` first.

## Look for: security (tenet T12)

- `permissions:` widened, `id-token: write` appearing, or a job gaining a
  secret it did not need before - especially any secret reachable by a step
  that also processes untrusted text (PR bodies, issue titles, diffs).
- `pull_request_target` combined with a checkout of the PR head.
- Untrusted interpolation: `${{ github.event.* }}` (titles, bodies, branch
  names) expanded directly inside `run:` shell - route through `env:` instead.
- Unpinned third-party actions gaining write permissions; prefer SHA pins for
  anything beyond `actions/*`.
- Deploy-config changes that reroute prod: Vercel build command, EAS submit
  identifiers, channel names.
- Agent workflows (`review`-adjacent): tool allowlists loosened, model steps
  gaining non-Anthropic secrets (the deploy/model separation must hold).

## Look for: does this change what CI catches or lets pass

- A required-check job's `needs:`/`if:` condition narrowed, or a new
  conditional path that can make a previously-unconditional check skip.
- A classifier that decides which tests/journeys run (`scripts/verify/impact-plan.mjs`,
  `scripts/sim/simulator-actions.mjs`, `scripts/verify/focused-tests.mjs`) becoming
  *more permissive* - fewer paths treated as sensitive, a narrower "unmapped means
  full coverage" fallback, a new early-return that skips classification. Compare
  against the existing conservative-by-default pattern in that file; a narrowing
  needs a clear, checkable reason (a real false positive, with the fix scoped to
  exactly that case), not just fewer checks running.
- A test deleted, skipped (`.skip`, `xit`, commented out) or its assertion
  weakened (a tighter `toBe` loosened to `toBeTruthy`, a removed `assert`) without
  an equivalent replacement elsewhere in the same PR.
- A budget, threshold or retry count loosened (longer timeout, higher retry
  cap, raised size/coverage limit) without a measured reason in the PR body.
- Acceptance/validation logic (`scripts/verify/product-flow.mjs`'s `validate()`,
  branch-protection config, the `Verify` aggregate job's required-job list)
  made more lenient: a dropped `insist`, a new bypass path, a required job
  removed from `needs:`. Each new allowance should be narrow, explicit about
  its preconditions, and leave every existing passing case exactly as strict
  as before - not a general loosening.

## Examples from real incidents

- Reviewer harness executed from the reviewed branch: the poller ran
  its review runner from the PR's own checkout, letting any PR edit its reviewer
  (and old branches simply lacked the scripts). Tell: automation that
  executes scripts from a ref the automation is judging. (#240)
- A whole-tree hash gate (`validate()`'s `inputHash` check) force-invalidated
  every acceptance report on any unrelated main-side commit, including
  tooling-only changes - not a vulnerability, but exactly the "what does this
  change let through/force" question this lens exists to ask about any new
  gate or reuse path touching that function. (#773/#794)

## Verdict discipline

For the security half, the blast radius is the whole pipeline; a PLAUSIBLE that
would leak a secret is worth confirming with an extra file read before you
downgrade it.
For the CI-impact half, judge the actual new coverage, not just intent: read
the specific new condition/threshold/bypass and confirm what case it newly
allows through, and whether that case is narrow and justified or just fewer
checks running.
