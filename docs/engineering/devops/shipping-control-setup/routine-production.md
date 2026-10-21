**TL;DR:** Install the independently reviewed automatic Deploy path with project-scoped credentials and a main-only environment.

`Deploy` follows successful pinned main-push `Verify` through `workflow_run`.
It verifies the actual workflow/run/current-main identities, exact reviewed PR/tree, existing App checks, current issue acceptance and trusted candidate/main CI.
The approval App remains the independent PR review and acceptance issuer; its key never belongs in CI.
The former routine App `workflow_dispatch` trigger is removed by this replacement.
Retire its routine dispatch continuation only after the replacement pilot succeeds; the old dispatch CLI is no longer a supported production entrypoint.
`production-release` remains for sensitive maintenance and `production-native` remains for native/Apple release decisions.

Root owns installation after independent correctness and workflow-security review.
Create `routine-production` using `routine-production-environment.json`, with exactly one custom deployment branch policy: type `branch`, name `main`.
Allow no tag or other branch and no required-reviewer rule for this routine environment.
Place `VERCEL_TOKEN`, `PROD_DATABASE_URL`, applicable `EXPO_TOKEN` and optional existing smoke credentials only in this environment, never repository secrets.
Verify actual provider identity, scope, expiry and access before installation; secret-name presence is not proof.
Preserve the existing protected branch and independent App issuer requirements.

Use the existing provider identity and only Vercel project `fitsy-api` (`prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4`) on team `team_VVc52BrZfx5IT2B1mDI5AuPT`.
Keep Git main auto-deployment disabled so production builds start only after admitted Verify.
The workflow installs pinned Vercel CLI `50.37.0` without credentials.
That CLI has `api --method POST --input FILE`; it has no `tokens` subcommand.
For a finite project token, the documented `POST /v3/user/tokens` supports `teamId` and a body with `name`, `projectId`, `expiresAt`.
Root must privately capture its one-time response and prove actual project-only deployment, promotion and readback access plus expiration; do not fall back to a full-account/team token.
The existing account dashboard's project selector is an alternative if that supported API cannot establish the required scope.
An installed CLI's failed user-token-list request does not prove token creation unavailable.

`vercel-release.py` supplies credentials only to provider API/CLI transport with isolated CLI configuration.
It uploads a clean exact checkout through `deploy --prod --skip-domain --yes`, with nonsecret commit metadata and the existing health commit variable.
It captures the prior serving target, checks the returned immutable deployment's project/source/production/READY identity, rechecks main, and promotes that exact target.
No provider credential reaches dependency installation, production build variables or API smoke.
The retained `vercel-release-RUN_ID` artifact records phases and exact previous/target URLs without secrets.
Read actual alias/deployment state before resuming after any uncertain mutation; never blindly repeat a promotion or build.
After successful promotion, serving identity and health `deploymentSha` are checked before and after the existing prod-safe API smoke.
For rollback, use the captured known-good URL: `bash scripts/deploy/rollback.sh api https://PREVIOUS_URL`.
Do not select the second-newest READY deployment because staged builds can occupy that position.

OTA still uses the existing lease, rollback hold, verified native baseline, production environment, iOS-only publication and group/bundle readback.
It compares actual production iOS `gitCommitHash` inputs with the release checkout under the lease, so API-only survivors reconcile pending mobile work and already-applied inputs return N/A.
Unknown production update source fails closed instead of manufacturing a duplicate update.
Publish OTA only for actual eligible compatible unapplied mobile inputs.

Root must verify the installed workflow/environment consumer, missing/wrong-project credential refusal, failed migration/build withholding, exact alias/source health, applicable OTA/N/A evidence and rollback before marking adoption complete.
Issue 471 itself may be the independently reviewed real workflow pilot after exact-main CI; no invented product change is required.
Keep one existing owner and resume action for failure, with production installation and provider mutation outside candidate source-worker custody.
