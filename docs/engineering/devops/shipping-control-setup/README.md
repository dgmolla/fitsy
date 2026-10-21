# Independent shipping installation packet

**TL;DR:** This packet prepares an isolated approval issuer and protected release using existing review, GitHub and release commands.

The single-human release proposal is [the App dispatch packet](single-human-dispatch.md).
The human withdrew account switching; retain the created account and earlier custody
evidence without requesting login or deletion. Candidate custody continuation is the
uninstalled [profile-bound resource/control contract](../resource-control-continuation.md).
It supersedes the former second-human/workflow_run assumption; [single-human viability](single-human-viability.md) retains the earlier read-only diagnosis.
These files are uninstalled templates until the selected coordinator verifies the genuine independent control review and completes the readbacks below.
Null identity values are unresolved security inputs, never defaults or simulated installation receipts.
No App registration, credential grant, production setting change, deployment or legacy retirement is performed by this packet.
The selected standalone skills retain coordination and evidence planning authority.

```mermaid
flowchart LR
    W[Exclusive worker and frozen candidate] --> R[Existing read-only reviewer]
    R --> O[Separate operator checks genuine raw execution and original accounting]
    O --> C[App-bound review and acceptance checks]
    C --> M[Protected PR merge]
    M --> V[Exact main Verify]
    V --> A[Isolated App dispatch of exact verified source]
    A --> E[Human protected environment reviewer]
    E --> D[Existing migration, Vercel promotion and guarded iOS OTA]
    D --> P[Main Deploy and observed product acceptance]
```

## Observed boundary and concrete identity inputs

The candidate currently executes as the same OS user that holds the `dgmolla` repository administrator credential.
Main protection requires only `product-flow/local` with `app_id: null` and administrator enforcement enabled.
It does not prove independent approval issuance.
The public repository has no configured production approval rules, and Deploy consumes repository-level production secrets.
An App remains unverified because the existing user token cannot enumerate App-authenticated installations.
Do not infer that an App is absent or repeat the prior metadata request.

The existing GitHub account `dgmolla` has user ID `18452532`.
The existing Verify and Deploy workflow IDs are `352020416` and `352171272`.
Observed Actions check issuer ID is `15368`; this binds test transport, not independent review authority.
The proposed independent check names are `delivery/independent-review` and `delivery/acceptance`.
An existing independently held App can serve this interface after its actual ID, installation and credential separation are verified.
Otherwise `github-app-manifest.json` supplies a private, one-repository registration proposal with Checks write, Actions write and read-only repository evidence permissions.
For the existing App5285837/installation170592990, only Actions read to write is proposed; this is an unsubmitted new grant requiring human approval.
The dispatch packet assesses its broader effective permissions and exact isolated token custody.
It requests no Contents write, workflow write, merge bypass, secret access, webhook subscription or scheduled service.
App registration and installation are final external security grants, not worker actions.
Use the [GitHub manifest procedure](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) or enter its exact permissions in the existing App registration UI.
Keep the manifest conversion code, PEM key and installation token entirely in operator custody.
The inactive webhook needs no receiver or daemon.

The remaining custody input is independently validated execution separation: the prepared profile contract requires pinned live command denials and original claim/process identity. The default separate-UID schema remains fail-closed until that replacement is independently approved and installed. Other inputs remain the actual independent App ID and token, independently initiating App bot identity, human protected release reviewer distinct from that bot, pinned installed GitHub CLI path/digest, independently approved control commit/digest, reconciled evidence digests and frozen acceptance recipes.
Operator `dgmolla` credentials must be relocated and revoked from candidate access before they count as independent authority.
Creating another folder under the current unrestricted user does not establish isolation.

## Credential isolation and supported operator commands

Use the selected committed sandboxed-worker entry point and independently verify its live permission-profile boundary. Do not initiate another account switch or treat a private folder as isolation.
The candidate must have no root/sudo access or ability to modify the operator account, installed adapter, GitHub CLI, App keys or environment approval credential.
Keep the original frozen source and evidence recoverable before changing account custody.
No new paid service or account is required by the design.
If the current host cannot enforce that separation, preparation continues here and installation remains withheld.

The security operator installs the independently reviewed committed adapter at `/opt/fitsy-approval/external-approval.py` and fills `/etc/fitsy/delivery-authority.json` from `operator-config.json` on Linux.
On macOS the adapter's fixed config location is `/opt/fitsy-approval/delivery-authority.json`; replace the template's `/var/` custody paths with `/private/var/` before installation and use the operator account's actual canonical home for existing review/accounting files.
Keep macOS operator configuration under the protected install root because the native minimal runtime grants reads under `/etc` and `/private/etc`.
Apple's `/etc` and `/var` aliases are symlinks; do not weaken symlink rejection to accept them or resolve a caller-selected config location.
Both paths and every ancestor must be root/operator owned and not group/world writable, with no symlinks.
Credential files are private mode `0600` under `/var/lib/fitsy-approval/credentials/`.
Run the executable directly so its system Env launcher removes startup selectors before isolated Python begins.
The default adapter rejects caller copies, unsafe ancestry, same-UID candidate authority and changed installed bytes. The prepared explicit profile mode additionally requires operator-pinned independent/live boundary proof; it is not an installed exception merely because its fixtures pass.
It ignores candidate GitHub configuration, tokens, proxy settings and executable selection.

Retain the existing `.fitsy-review/completed/issue-N.json`, raw provider files and original `.cache/fitsy-review/budgets/issue-N.jsonl` in isolated operator custody.
The selected coordinator independently observes actual provider execution and checks all source/base/acceptance/domain/provider identities before approving their digests.
Self-consistent hashes or a copied transcript do not establish genuine independent execution.
The config pins the existing completed manifest and post-reconciliation ledger, not a new projected verdict cache.
Its `accounting_provenance` points to the coordinator's actual source-bound accounting verification.
Every failed, incomplete and malformed historical execution remains retained and charged.
Use the separately approved installed existing accounting operator to reconcile bootstrap execution before publishing checks.
The adapter neither grants review capacity nor edits original history.

The installation owner checks the committed adapter digest and `control_sha` against the independently approved frozen control review.
Populate `control_paths` with the exact independently reviewed migration files, never product files or a wildcard selection.
For #443 the adapter permits an integrated candidate only when every product blob and file mode equals the original frozen reviewed source and every listed control blob equals the independently approved control source.
All extra, missing, modified or redirected product files refuse reuse.
This changes no #443 raw review, UI approval or original ledger and launches no product reviewer.

After the operator has validated the actual receipt identities, use these one-shot commands:

```sh
/opt/fitsy-approval/external-approval.py publish-review --issue 463 --pr PR_NUMBER
/opt/fitsy-approval/external-approval.py publish-acceptance --issue 463 --pr PR_NUMBER --verify-run PR_VERIFY_RUN
/opt/fitsy-approval/external-approval.py dispatch-release --verify-run MAIN_VERIFY_RUN
/opt/fitsy-approval/external-approval.py release-ready --run ACTUAL_APP_DEPLOY_RUN --verify-run MAIN_VERIFY_RUN
```

Replace symbolic run/PR arguments with actual IDs; null configuration inputs deliberately fail closed.
Both protected check publication commands validate pinned token issuance, expiry, effective App permissions and live Fitsy-only scope before proceeding.
`publish-review` loads only coordinator-verified existing raw execution and rechecks live PR source and normalized issue acceptance before posting an App-issued check.
`publish-acceptance` additionally requires independently observed full local acceptance with the exact source identity, arguments and required result set, plus the latest successful exact-source PR Verify run.
Populate `local_acceptance` from the selected skill's applicable full recipe and actual canonical receipt, including native proof where required.
A cheap receipt, narrow subset, missing native proof, failed required check or changed recipe cannot substitute.
The App token must be a real installation token for only `dgmolla/fitsy` and is renewed in isolated custody through GitHub's existing token API.
The adapter verifies the returned check's actual App ID instead of treating an issuer label as authority.
The read-only evidence permission can inspect current protection; it cannot change protection or merge.

`release-ready` requires the actual current main source, successful main push Verify, exact required check issuers, retained required `product-flow/local` protection and its successful reviewed-head status, one merged PR and equal reviewed-candidate/release trees.
It authenticates the release credential's actual GitHub user, requires both actual initiating actors to be the separately verified App bot, refuses either initiating actor as reviewer, and reads back self-review prevention, administrator bypass prevention, exact environment reviewer and main-only branch policy.
It revalidates the original source-bound review or the explicitly permitted #443 control composition.
It reports the existing pending production environment IDs without approving them or obtaining production credentials.
The protected human environment reviewer inspects the exact pending run, installed workflow bytes, current main source, successful Verify and outstanding UI/native/legal gates immediately before approval.
Use GitHub's existing pending-deployment approval UI or REST API; do not treat the readiness report as a release grant.

## Exact protected-check and environment changes

Capture current branch protection, rulesets, all environment rules/branch policies, repository/environment secret names, App installation permissions and current Vercel project settings into the existing issue evidence directory.
Do not capture secret values.
Keep all active claims and commands with their owners during the change.

Fill the two independent `app_id` values in `main-protection.json` with the verified App ID.
Retain `product-flow/local` as a product requirement; its legacy unbound transport is supplemented by independently validated `delivery/acceptance`.
Preserve any additional live protections found at installation rather than blindly replacing them with a historical template.
Update the existing protection through `PUT /repos/dgmolla/fitsy/branches/main/protection` using the isolated administrator credential.
Read back strict exact-source checks, actual issuer binding, required PR integration, administrator enforcement and no force/deletion permission.
Candidate credentials must not have administration, protection bypass, independent Checks write, environment approval or release access.
Create `main-custody-ruleset.json` with `POST /repos/dgmolla/fitsy/rulesets` and record its returned ID in operator configuration.
GitHub can omit the optional update parameters object in a ruleset readback.
The validator accepts exactly one update rule with omitted parameters or the exact `{"update_allows_fetch_and_merge":false}` object.
Present null/invalid parameters, true, numeric substitutes, unknown keys and extra rules still refuse; scope and bypass requirements remain exact.
This separate update-only ruleset permits only the isolated `dgmolla` user to update main through PR integration.
Its narrow bypass does not bypass the separately enforced required-check branch protection.
Read back the exact actor, PR-only bypass, main scope and update rule, and observe candidate merge/direct-push rejection.
The [ruleset API](https://docs.github.com/en/rest/repos/rules) supports this explicit User actor for the public personal repository.
Immediately before integration, the isolated merge operator revalidates live issue acceptance, original review, latest full acceptance and exact PR head, then uses `gh pr merge --match-head-commit REVIEWED_SHA` through the existing authorized integration entrypoint.
Candidate credentials may not edit authoritative issue acceptance, approve environments or exercise this merge actor.
Do not enable auto-merge using a previously issued acceptance check after acceptance changes.
GitHub documents [App-bound required checks](https://docs.github.com/en/rest/branches/branch-protection).

`production-environment.json` and `release_reviewer_user_id` now propose the known sole human `dgmolla` (`18452532`).
This is valid only with actual independently initiated App deployment, never a human-triggered or human-rerun deployment.
Retain self-review prevention, administrator bypass rejection and verified separate OS custody.
Keep that human's protected credential in `release_token_file`; it must never reach candidate execution or the App workflow.
The token's real authenticated `/user` and the pending run's actual approval eligibility remain installation probes.
Create `production-release` from the completed template with self-review prevention; unresolved identity values must refuse configuration rather than default to the merge user.
Disable administrator bypass in the environment settings UI and read back `can_admins_bypass: false`; the public PUT environment API does not document that setting as an input.
Set its custom deployment branch policy to branch `main` through `POST /repos/dgmolla/fitsy/environments/production-release/deployment-branch-policies` with `{"name":"main","type":"branch"}`.
Apply the same approval protection to `production-native`, adding only explicitly approved native tag policies through the existing native release process.
`eas-build.patch` routes the existing build/submission job to that protected native environment.
Environment approval cannot substitute for human Apple, legal, submission or product authorization.
Read back actual reviewers, self-review prevention, bypass setting and branch/tag policies using the [environment API](https://docs.github.com/en/rest/deployments/environments).

Move `PROD_DATABASE_URL`, `EXPO_TOKEN` and production smoke credentials into protected environment custody.
For `PROD_DATABASE_URL`, use the verified production Supabase session pooler on `aws-1-us-east-1.pooler.supabase.com:5432`, database `postgres`, and user `postgres.zaxkmjqozvmbifiwbxps`.
Construct the private URI from the already held production password and append `sslmode=require&sslaccept=strict&sslcert=../docs/engineering/devops/shipping-control-setup/supabase-root-2021-ca.crt`.
Prisma 6 resolves `sslcert` relative to `prisma/schema.prisma`, so the committed public certificate remains available after checkout on the Linux runner.
The certificate came from [Supabase's published 2021 production CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt); its PEM SHA-256 is `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
The production migration and monthly snapshot both consume this same protected secret; the transaction pooler on port 6543 and a Mac-local certificate path are not valid inputs for these jobs.
Before installing the secret, verify a read-only Prisma CLI and Prisma Client query with the exact private URI in a neutral Linux runtime, and require both an unrelated CA and a wrong hostname to fail.
Do not put the URI, password, or a live query result in the repository or candidate environment.
The existing monthly dev snapshot uses a production credential even though its code starts a read-only transaction; this is not a read-only credential grant.
Its job requires `production-release` and branch `main`; nightly reset and drift checks retain dev-only credentials.
If self-review prevention holds a scheduled or human-initiated monthly run, the isolated App operator can initiate the existing `workflow_dispatch` on reviewed main before the human approves the protected job.
That dispatch also runs the nightly dev reset, so coordinate the existing dev test window before execution.
This does not add a scheduler or waive environment approval.
Place `EXPO_TOKEN` in both `production-release` for OTA and `production-native` for native delivery before removing its repository-scoped copy.
Inventory `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `JWT_SECRET` and other existing repository/Vercel credentials by their real privilege before relocation; names alone do not prove dev or production identity.
Copy each required secret securely from its current holder into the correct environment, validate presence without exposing values, then delete or revoke its repository/shared-host alternate route.
Never delete an unknown secret merely because its name resembles a production credential.
Candidate CI receives only ephemeral/dev credentials and its normal read/test transport.
App and environment approval credentials stay outside every candidate-controlled workflow and dependency installation.

`deploy.patch` is an inactive, reviewable change to the existing Deploy workflow.
The original patch files retain their preparation bytes after application to the repository targets.
The resolved workflow binds the authenticated App actor `341457831` / `fitsy-delivery-approval[bot]`.
Independently review the final resolved workflow bytes before integration or installation; local application does not establish remote enforcement.
It accepts only source-bound App `workflow_dispatch` after successful main push Verify, verifies both actual initiating actors before production jobs, and checks out that exact input source in every job.
Unresolved App actor placeholders fail closed; installation requires independently approved resolved bytes and pinned deploy/verify workflow digests on default main.
It rejects a superseded main source before proceeding, binds `RELEASE_SHA` to the verified source and retains existing release serialization.
Every surviving release conservatively reconciles migration, API and mobile surfaces so pending-run replacement cannot hide a release.
Migration, smoke and OTA jobs enter `production-release` before they can receive environment secrets.
The independent reviewer rechecks the source and immutable workflow bytes for each pending environment job.
Existing migration safeguards, production API smoke, iOS binary compatibility, OTA leases and rollback commands remain intact.

Disable automatic Vercel production builds before cutover with the prepared `vercel.patch` main-branch deployment setting and corresponding verified project settings for both `fitsy-api` and `fitsy`.
Disabling only domain auto-assignment still exposes production build credentials before main Verify, so it is insufficient for this boundary.
Keep preview builds dev-only and verify no alternate production deployment hook or shared-host Vercel token remains available to candidate execution.
After successful main Verify and independent environment authorization, the isolated release operator uses the existing Vercel CLI on the exact reviewed release source with `vercel deploy --prod --skip-domain --yes`, verifies the resulting project/source/environment identity, then uses `vercel promote DEPLOYMENT_URL --yes`.
The existing smoke job observes that exact production deployment and exercises the production-safe API checks.
The installed CLI help and [Vercel deployment documentation](https://vercel.com/docs/cli/deploying-from-cli) support staged production and promotion.
No production command is executed to test setup preparation.

## One controlled cutover and rollback

First independently review the complete frozen controls and this packet through the existing trusted reviewer adapter.
The selected coordinator separately verifies actual execution, raw artifacts and exact committed source before installation.
Apply inactive workflow patches only as part of that approved installation; they do not establish installed protection while sitting in this directory.
Before disabling local session/socket/admission controls, prove the real replacement with issuer/readback evidence and both rejection and valid-candidate cases.
Use a disposable protected probe branch/PR and no production credential to observe forged-check, changed-source, changed-acceptance and failed-check rejection.
Observe an unauthorized candidate's inability to obtain environment secrets or approve the pending environment.
Exercise valid independent provider evidence through the real App-bound checks and protected PR path.
Fixtures and local test counts remain a separate evidence category.

Only after those checks pass may the coordinator retire obsolete local admission/session/socket and automatic review entrypoints through separately reviewed exact-source changes.
Retain public product verification commands, original ledgers, the deterministic exclusive claim/lifecycle helper and the sole routine publisher.
Do not switch off a live worker, acceptance process or simulator to simplify cutover.
Do not retain two active shipping authorities.

For rollback, preserve the pre-cutover configuration and reviewed source, but leave independent issuer protection and credential isolation enabled.
Stop new admissions, retain pending claims/evidence and restore only a separately approved compatible adapter/workflow.
Restoring the shared administrator token, unbound approval or unprotected production secrets is not a valid rollback.
Production rollback remains the existing `scripts/deploy/rollback.sh` under isolated, authorized release custody.
Keep known-good Vercel deployment URLs and iOS update-group/native-baseline identities in the issue handoff.

## Nutrition pilot and completion

Finish independently verified control readiness under #463 ownership, then release confirmed inactive ownership through the existing helper before the coordinator admits #443.
The pilot keeps source `fe24cebe2bbfbdaad995561d1f2b14384e3e7a2e`, base `257f8c2f696d4f0b7cf04a5620dcc76906b6f785`, genuine `252.81189254205674` second review and unchanged approved UI.
No additional #443 product review is authorized.
Build the integrated candidate by applying only exact independently approved control blobs and prove that composition through the adapter before reusing review.
Run applicable full acceptance/native journeys, protected PR checks, authorized merge, successful main Verify and Deploy, and observed affected product behavior.
Report local validation, independent review, installed protections, merge, deployment and product proof separately.
The migration remains incomplete until invalid candidates are rejected by installed controls and #443 actually ships through them.
Emit the required dispatcher terminal receipt only with actual successful release-SHA Verify, Deploy and acceptance identities.
