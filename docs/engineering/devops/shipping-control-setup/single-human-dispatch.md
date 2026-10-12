# Single-human App dispatch setup

**TL;DR:** Prepare App-initiated release with human protected approval, then verify actual identity and custody before installation.

This packet prepares issue #463 under claim `dc17e154-dad6-4f12-922f-b38b9537332f`, starting at `1f5fb8030a98729879f1783b0bef644117433240` against base `257f8c2f696d4f0b7cf04a5620dcc76906b6f785`.
The selected standalone package is `228ec3597354f520ac19857ab74d8a1b472039df` with the three assignment-pinned skill hashes recorded in the private acknowledgment.
The current proposal supersedes only the earlier second-human reviewer and `workflow_run` initiation design.
No grants, credentials, accounts, installation, push, merge, environment approval or release have been performed.
Actual frozen control source, content hashes and independent review receipt belong in the final source-bound handoff, rather than a self-referential source field in this document.
The installed workflow identity, App bot identity and approval eligibility remain unproved until actual readbacks.

```mermaid
flowchart LR
    C[Standard candidate Mac account] --> T[Full product checks and genuine review]
    T --> O[Isolated operator verifies original receipts]
    O --> K[App-bound independent checks]
    K --> H[Human protected PR merge]
    H --> V[Successful main push Verify]
    V --> A[Isolated App dispatch: main plus exact source and acceptance]
    A --> G[Workflow rejects wrong actor or Verify before production jobs]
    G --> E[Human environment review with self-review and bypass prevention]
    E --> D[Existing protected production release commands]
```

## Exact final security grant proposal

Request only GitHub App `5285837`, installation `170592990`, selected repository `dgmolla/fitsy`: change repository **Actions read to write**.
Preserve Checks write, Contents read, Issues read, Pull requests read, Administration read and implicit Metadata read.
No Contents write, Workflows write, Deployments write, Environments write, Secrets write, administration write, organization permission, additional repository, webhook, paid service or second GitHub user is requested.
The prepared manifest describes these exact effective permissions; it does not register a new App.
The human must approve both the App permission change and the existing installation's updated permissions when GitHub requests them.
Neither approval has been submitted here.

GitHub requires Actions write for installation-token [workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
This is a proposed mechanism supported by the API contract; actual App actor behavior and environment eligibility are mandatory probes, not inferred facts.
Actions write is broader than dispatch: it includes workflow enable/disable, run cancellation/rerun/deletion, fork-run approval, artifact/log deletion and cache management.
It can trigger any dispatch-enabled workflow in Fitsy, not just Deploy, and can destroy or disrupt Actions evidence or consume execution resources.
Existing Actions read already permits reading run logs, artifacts and caches, which can contain sensitive data when workflows leak it.
The complete effective REST surface is the [GitHub App permissions table](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-actions); do not describe this grant as dispatch-only.
Read-only Administration does not grant protection edits; Checks write remains powerful source-check issuance authority.
No token is passed to candidate code, dependencies, CI, workflow inputs, artifact upload or the GitHub environment.
The isolated one-shot adapter uses the token only through the pinned GitHub transport and explicit supported operations.
Protected review checks, immutable source/workflow verification, isolated credentials and human environment review limit the supported path; they do not reduce GitHub's actual token permissions.
Compromise of the operator account or App key remains outside the candidate isolation boundary and requires credential revocation and stopped admission.

## Exact Mac separation and human-only setup

The human creates standard Mac account `fitsy-candidate` and moves all implementation/reviewer candidate execution there.
The current operator account retains Notes, login keychain, browser administration, `gh` merge credentials, Vercel/Expo production credentials and environment approval.
Authenticated account creation, login switching, key relocation/creation and confirmation/submission are human-only operations.
Do not read or export the Notes key from this task.
A folder or token split under the present shared UID is insufficient.

After human-created setup, record actual numeric UIDs with `id -u fitsy-candidate` and `id -u` from the operator login; require different non-root UIDs.
Record `id -Gn fitsy-candidate` and `dscl . -read /Groups/admin GroupMembership`; require no candidate admin membership.
From the candidate login, `sudo -n -l` must not expose root or operator execution; the human/operator must inspect sudoers and authorization routes so a missing cached password alone cannot count as denial.
Exclude candidate root, sudo, operator password, SSH/login access to operator identity, shared automation bridges and the ability to control the operator's authenticated desktop.
Inspect Accessibility, Automation, Screen Recording and Full Disk Access permissions for the actual candidate executables and login sessions.
Deny candidate automation of the operator's Notes, browser, Terminal, Keychain Access and GitHub/release UI; do not keep a shared authenticated operator desktop exposed to candidate computer-use tools.
Test attempted operator-session automation with a harmless, secret-free target and record denial.

Inventory all shared credential routes without recording secret values: Notes/iCloud, login keychain, browser profiles, `gh`, Vercel, Expo, shell startup, SSH, environment variables, files and existing workflow/repository secrets.
The human relocates required authority to operator-private storage and revokes every candidate-accessible copy/session; a key retained in shared-access Notes does not establish custody.
From the candidate login, use `test -r`/`test -w` and harmless access probes to record read/write denial for operator credential locations, Notes database, keychain and browser profiles without opening their contents.
Candidate execution may receive only scoped ephemeral/dev credentials and normal read/test transport, with no issue-acceptance administration, App check issuance, protected merge, environment approval or production route.
Installed adapter, config, GitHub CLI and every ancestor must be root/operator owned, non-writable to candidate and non-symlinked.
Use `/opt/fitsy-approval/external-approval.py`, `/private/etc/fitsy/delivery-authority.json` and canonical `/private/var/lib/fitsy-approval/` custody paths on this Mac.
Credentials and token-provenance files are private `0600` under operator-controlled ancestors.
Pin actual CLI digest, reviewed adapter/control identity, UIDs, environment reviewer, ruleset ID and exact deploy/verify workflow digests.
These instructions preserve existing ca7 transport, installed-location and same-UID rejection; local tests cannot prove OS isolation.

## Supported installation-token provenance

Installation tokens cannot use JWT-only `GET /app` or `GET /repos/dgmolla/fitsy/installation`.
The human/operator uses the existing GitHub App token API in isolated custody after the grant; this task neither creates a credential nor adds a token service.
At each explicit token renewal, the operator observes and retains the real [authenticated App and installation responses](https://docs.github.com/en/rest/apps/apps#get-a-repository-installation-for-the-authenticated-app) and exact [token issuance](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).
Mint only for Fitsy's actual repository ID with the exact effective permissions above.
Keep the token and JWT secret; never store them in evidence, prompts or manifests.
Retain token response metadata with `token` removed, replaced by `sha256` of the exact private token file bytes; include `expires_at` and effective `permissions`.
Record the actual Fitsy repository ID and live bot `/users/APP_SLUG[bot]` identity.
Do not substitute App ID or installation ID for bot user ID.

The existing operator config gains `installation_id`, `app_identity_file`, `app_identity_sha256`, `dispatch_actor_user_id`, `dispatch_actor_login`, `deploy_workflow_sha256` and `verify_workflow_sha256`.
The private token-provenance JSON has `app` (actual authenticated App response), `installation` (actual repository installation response), `token` (redacted issuance metadata plus exact-file digest) and `repository_id` (observed Fitsy ID).
The independent operator pins its digest only after personally observing those responses and custody; a self-consistent candidate-written receipt is not issuance proof.
This short-lived credential provenance repairs the demonstrated absence of issuer/installation metadata in installation-token scope responses; it is not a verdict cache, grant, queue or new workflow engine.
Renewals preserve prior raw receipts rather than erasing them.
The adapter checks issuer5285837/installation170592990, exact permissions, token digest/expiry, live Fitsy-only scope, live App ID and live Bot identity before either protected check publication, dispatch or readiness.
Missing, wrong, changed or expired metadata refuses.

## Existing command extension and exact source binding

First independently approve the frozen changed adapter and workflow template, and have the selected coordinator separately verify actual provider execution and original cumulative accounting.
Resolve actor placeholders only from authenticated live App/bot readbacks; independently validate the exact rendered workflow bytes before installation.
The `INSTALLATION_PROBE_REQUIRED` placeholders fail before any API dispatch gate or production secret access until resolved.
Fill null config identity/digest values from actual observations, never candidate selectors or fixtures.
Apply `deploy.patch` to the existing Deploy workflow only during the approved controlled cutover.
Keep the existing Verify workflow and independently pin its exact installed bytes as well.
The adapter requires both workflow IDs/paths to be active, default branch `main`, and the contents at exact release source to match protected installed digests.
Source/control changes require applicable independent control review; resolved bytes cannot approve themselves.

After protected human merge and successful latest exact-source main push Verify, the isolated operator runs:

```sh
/opt/fitsy-approval/external-approval.py dispatch-release --verify-run MAIN_VERIFY_RUN
/opt/fitsy-approval/external-approval.py release-ready --run ACTUAL_APP_DEPLOY_RUN --verify-run MAIN_VERIFY_RUN
```

The first command validates original source-bound review/acceptance, operator-observed full local acceptance, App-bound protected main checks, retained required `product-flow/local` protection and its current successful status on the reviewed PR head, merge custody, unique merged PR, equal reviewed/release trees, latest successful Verify and protected environment policy before issuing `POST /repos/dgmolla/fitsy/actions/workflows/352171272/dispatches`.
Its payload fixes `ref` to `main` and inputs to actual `release_sha`, `verify_run` and normalized `acceptance_sha256`; none is a caller-selected release source.
A last main readback detects pre-submit drift; the workflow compares input source to event SHA/current main to reject a ref race.
Inputs enter shell only as environment values with bounded syntax checks.
The run title binds the source, Verify ID and acceptance digest, and readiness verifies that title against current genuine evidence.
The workflow reads both actual `actor` and `triggering_actor`, requiring the pinned Bot identity before any production job, and rejects a human rerun.
It validates the successful latest main push Verify using the Actions API.
All production jobs retain their environment gates, source checkout, serialization, migration safeguards, smoke, native compatibility, OTA leases and rollback behavior.
An API 204 or newer run-ID response means dispatch submission only; no automatic duplicate retry after uncertain submission.
Read back the actual run before advancing.

`release-ready` revalidates current source/workflows/acceptance, both actual App initiating actors, the authenticated reviewer18452532, self-review prevention, administrator bypass disabled, exact required reviewer/main-only policy and actual `current_user_can_approve` on every pending production job.
The human may also be the merge actor only because both observed deployment initiators are the distinct verified App bot.
A human-triggered run cannot satisfy this exception.
Readiness does not approve an environment or execute a release.
Human approval of each pending exact-source job and all applicable product/UI/Apple/legal/submission decisions remain required.
Check source and latest Verify again immediately before every approval, including later jobs; never infer approval from the dispatch or readiness receipt.
Use the existing protected Vercel production deploy/promote and OTA/native commands from the main setup packet only after the applicable explicit release authorization.

## Required observed cutover probes and rollback

Retain live pre-cutover branch/ruleset/environment/Vercel settings, secret names without values, active commands, approved ca7 ancestry and raw attempts.
Keep current legacy entrypoints active until equivalent installed replacement is proved.
Perform one controlled cutover, using the existing coordinator and exclusive owner.
Actual probe runs use disposable protected PR/probe resources and harmless environment sentinels, withholding all production secrets and consequential release operations until authorization.
Use the exact approved source/workflow bytes and actual App identity, not a duplicate test pipeline.

| Probe | Required observation |
| --- | --- |
| Candidate same UID, operator files, credential stores or desktop | Refusal/access denial; no independent authority claimed. |
| Wrong App issuer, installation, token, repository scope or bot actor | Adapter refuses before dispatch/check authority can count. |
| Human dispatch or human rerun | Workflow gate fails before protected production jobs; readiness refuses. |
| Wrong/default-branch workflow, release source or source race | Adapter/gate refuses; no protected secret access. |
| Missing, failed, stale or superseded Verify/required checks/product-flow status | Dispatch and readiness refuse. |
| Forged/unbound review, changed acceptance or another-source title | Dispatch/readiness refuse; original raw history remains. |
| Admin bypass, absent self-review prevention, wrong reviewer or no actual eligibility | Readiness/protected environment refuses. |
| Actual valid App dispatch after protected merge | Read back App bot actor and triggering_actor, exact source/workflow/title/Verify, pending environment and human approval eligibility. |
| Valid frozen443 control composition and authorized release | Unchanged product blobs/UI/review plus approved controls, full applicable acceptance, actual main Verify/Deploy and affected product proof. |

Record actual GitHub rejection responses, check issuer IDs, run identities and environment/custody readbacks separately from local fixtures and independent review.
If GitHub does not attribute dispatch to the independently observed App Bot or the human cannot approve with self-review prevention, stop before production, retain exact failure and the reviewed ca7 rollback point.
Do not remove self-review prevention, disable admin enforcement, impersonate another actor or invent a successful probe.
Stop new admissions during rollback; preserve independent issuer checks, credential isolation, raw receipts and pending claims.
Restore only separately approved compatible controls; do not restore shared administrator tokens or unprotected production secrets as a shortcut.
Do not disable superseded session/socket/admission until installed negative/valid probes pass and active operations are reconciled.
Existing product verification commands, exclusive lifecycle helper and sole routine publisher remain.

Frozen443 stays `fe24cebe2bbfbdaad995561d1f2b14384e3e7a2e` against base257, with genuine252.81189254205674-second correctness/danger-zone review and unchanged approved UI.
No further443 product reviewer or concurrent443 implementation is authorized.
The valid composition validator must prove unchanged product blobs plus exact independently approved control blobs before review reuse, followed by applicable full native/API acceptance and actual shipment under existing ownership.
Retain original463 history3142.015647499007/stop3177 and latest3687.416401539929/stop3791, every malformed/failed/incomplete attempt and all genuine approvals.
Any bounded review allocation/execution is recorded additively in private source-bound authority and raw handoff receipts, with separate coordinator reconciliation before acceptance/release.
Completion remains installed rejection/valid proof plus actual443 shipment, not this preparation packet or fixture success.
