**TL;DR:** Require pull requests and the aggregate Verify check before merging into main; no human approval is required (AI review + CI gate merges).

The final `Verify` job depends on every existing verification job and runs even after failures.
Only classification-approved skips and the main-push domain-check skip pass.
Existing workflow jobs, required checks, issuer bindings and stricter review counts remain in place.

After this workflow and CODEOWNERS reach main, an administrator with `gh`, `jq` and repository Administration write permission can explicitly run:

```sh
bash scripts/github/apply-branch-protection.sh dgmolla/fitsy
```

The script requires up-to-date checks and administrator enforcement, keeps any existing approval count (default 0), and does not require code-owner approval; it clears PR bypass allowances and blocks force pushes and deletion.
These requirements prevent unreviewed direct pushes; approved merges still proceed through GitHub.
It preserves existing push/dismissal restrictions and other branch flags, leaves rulesets and signature requirements untouched, enables repository auto-merge, and prints the resulting settings for inspection.
Enabling auto-merge does not enable it on individual PRs or waive any gates.
CODEOWNERS marks `@dgmolla` as owner for visibility; it is not enforced as a required approval.

`Verify` is bound to the GitHub Actions App, which rejects a same-name status from another issuer but cannot distinguish another Actions workflow with the same job name.
Keep existing independent approval/release gates and reconcile their pinned Verify workflow digest through the existing reviewed installation before cutover.
Before declaring remote adoption, inspect the printed settings and demonstrate rejection of failed/stale checks, a forged same-name check and an unapproved control change in a disposable repository with equivalent rules.
This PR prepares configuration only; remote installation and those acceptance checks are separate administrator actions.
See GitHub's [branch protection API](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection) and [protected branch behavior](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
