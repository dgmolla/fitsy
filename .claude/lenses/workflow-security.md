# Lens: workflow-security

Runs when a PR touches `.github/**`, `vercel.json`, `eas.json`, or
`scripts/deploy/**`. One concern: **the CI/CD surface stays least-privilege
and injection-proof** (tenet T12). Read `REVIEW.md` first.

## Look for

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

## Verdict discipline

The blast radius here is the whole pipeline; a PLAUSIBLE that would leak a
secret is worth confirming with an extra file read before you downgrade it.
