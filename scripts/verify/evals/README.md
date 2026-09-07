# Lens eval corpus

Every escaped defect becomes a permanent eval case here (harness-audit
requires it on incident PRs):

    incidents/<issue-number>/
      diff.patch        # the change that shipped the bug (git diff or PR patch)
      expected.json     # {"lens": "...", "must_find": "one-line description"}

`replay.sh <issue-number>` re-runs the named lens against the captured diff
and fails if the lens misses the finding - proof that a lens edit actually
improved recall, and a monthly recall report over the whole corpus:

    for d in incidents/*/; do bash replay.sh "$(basename "$d")"; done

Empty until the first real incident, by design: lenses are tuned on actual
misses, not imagined ones (autonomous-shipping.md, rollout step 8).
