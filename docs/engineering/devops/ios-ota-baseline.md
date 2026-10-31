# Verified iOS OTA baseline

The OTA gate compares Expo's iOS native fingerprint with the actual verified binary for the selected channel.
Uploaded build 7 uses fingerprint runtime `58699659d0433dd381a23a994c7ee97f41a97902` and the embedded `production` channel.
Automatic OTA still targets `testflight`, so the channel mismatch blocks publication independently of the incomplete IPA verification.
Build 5 has no verified Expo fingerprint and remains blocked on its separate production channel.
An incomplete binary receipt, including a missing IPA hash or verification timestamp, still blocks OTA.
Issue #243 reproduced the false positive in main Deploy run [37685925003](https://github.com/dgmolla/fitsy/actions/runs/37685925003), at source `89c23ce6e5272f7fdc9a599131329e4034b23037`.
That tag predates the actual production binary and therefore cannot establish its native compatibility.

```mermaid
flowchart LR
  B[Verified EAS and Apple binary] --> R[Reviewed source baseline]
  R --> G[Expo iOS fingerprint and runtime comparison]
  G --> E[Production Google scheme comparison]
  E --> P[Channel policy and release approval]
  P --> O[iOS OTA on the selected channel]
  G -->|Changed or unavailable| H[Hold for verified binary]
  E -->|Changed or unavailable| H
```

## Actual binary evidence

### Uploaded build 7

Read-only EAS build and submission pages on October 31, 2026 confirmed the completed build and upload.
The build's runtime-resolution log records the fingerprint below, and its Expo.plist configuration log explicitly records `expo-channel-name: production`.
The local iOS fingerprint matches that runtime with configured build number `7` and fingerprint package `0.15.4`.
EAS marks the source checkout dirty; the recorded Git commit alone does not identify every uploaded input.

| Identity | Verified value |
| --- | --- |
| EAS build | `b72f175d-07b8-4a8e-a894-2fe33fed7baa`, succeeded, iOS store, production profile/channel |
| Build source | `c28460d3f857ef113819fa81c08fcb77a18e4148`, dirty checkout |
| App identity | `com.fitsy.mobile`, version `1.0.0`, build `7` |
| Runtime and fingerprint | `58699659d0433dd381a23a994c7ee97f41a97902`, fingerprint package `0.15.4` |
| EAS submission | `4109aff6-e456-43b6-a30c-3a7fb9bb5923`, succeeded upload to App Store Connect |
| Apple build ID | Unknown; the EAS submission ID is not an Apple build ID |
| IPA SHA-256 | See the binary receipt; `null` means artifact verification is incomplete and OTA remains blocked |

The artifact URL and build evidence are retained in `scripts/deploy/ios-binary-baseline.json`.
A completed EAS upload establishes upload evidence; it does not establish App Review acceptance or public release.
Read `eas build:view <id> --json` for the actual build identity, fingerprint and channel.
If shell networking is unavailable, read the authenticated EAS build/submission pages and runtime/configuration logs, and record that fallback in the task evidence.
Uploading to TestFlight does not imply the binary embeds the `testflight` OTA channel; retain the actual channel without changing release policy.

### Historical production build 5

Fresh read-only EAS and App Store Connect requests on October 7, 2026 confirmed the following identities.
The IPA was downloaded from the build's artifact URL and its actual embedded plists were inspected.

| Identity | Verified value |
| --- | --- |
| EAS build | `3391d4bf-905e-4c78-8ae3-4f88f7cbf51b`, FINISHED, IOS, STORE, production profile/channel |
| Build source | `2e515fdc339d27e33110e128379fb16bd3a2d3a5` |
| Apple build | `cc103859-443d-43d9-a165-da04534c952b`, VALID, unexpired, APP_STORE_ELIGIBLE |
| Info.plist | `com.fitsy.mobile`, version `1.0.0`, build `5` |
| Expo.plist | Runtime `1.0.0`, production channel, project `a204190c-0b71-4c31-b126-f3bc62d1c4ee`, updates enabled |
| IPA SHA-256 | `e31663a3f57f715a357ffbd487f4d912fe46ed9b5ac82543d3a87724ed506c56` |

The Google URL scheme compiled into Info.plist is `com.googleusercontent.apps.56878207179-voo8iloc0si51ae7n8illrsu3hapks4d`.
The helper loads the current production environment and rejects a different or missing corresponding client ID before publishing.
The app config's other environment variables affect JavaScript configuration rather than native configuration at this baseline.

## Fingerprint compatibility contract

`scripts/deploy/ios-binary-baseline.json` records the current uploaded binary, including its actual embedded channel.
Build 7's `production` channel does not satisfy the automatic `testflight` target; recording its upload does not authorize changing channel policy or production's historical receipt.
`scripts/deploy/ios-production-binary-baseline.json` preserves the historical production binary without substituting TestFlight evidence.
`ota-target.mjs` selects the matching receipt for both the compatibility guard and publication helper.
Each receipt retains the source SHA, EAS build ID, IPA SHA-256, bundle/build/runtime/channel identities, Google client ID, verification timestamp and evidence.
Production requires its Apple build ID.
TestFlight may record `asc_build_id: null` with a valid EAS submission ID and `eas_submission_status: "FINISHED"`; missing upload evidence or a fabricated Apple ID fails closed.
It also requires `fingerprint: { "hash": "<40 hex characters>", "package_version": "<exact @expo/fingerprint version>" }` from that actual build's source and environment.
Never stamp the current checkout's hash onto a historical binary receipt.

`native-compatibility.mjs` uses the `@expo/fingerprint` version supplied by the installed Expo SDK through `expo/fingerprint`.
Both the gate and EAS runtime resolution use `apps/mobile/fingerprint.config.cjs` and the iOS platform.
Expo hashes evaluated native app configuration, autolinked native dependencies and native resources rather than raw root package/lockfile or app-config text.
The shared configuration explicitly includes native plugin payloads, patches and build hooks, including Swift files copied by the widget plugin.
Only the runtime `extra` section is skipped because EAS Update delivers it in the JavaScript manifest; schemes, permissions, native resources and updates URL remain covered.
API-only dependency edits, build-time guard changes with identical evaluated native config, JS, styles and arbitrary bundle-only assets do not require a binary.
Native modules, permissions, plugins, icon/splash, Expo SDK and widget/Swift changes do.
Missing ancestry, malformed or missing fingerprints, a different fingerprint package version, partial Expo collection and runtime/bundle mismatches fail closed.
Ignored local native inputs still block publication, including generated iOS directories.
The check repeats inside EAS's production environment and rejects a missing or changed Google URL scheme before export.

## TestFlight baseline and channel policy

The next protected EAS Build workflow uses the `testflight` store profile, production environment and `testflight` channel.
`app.config.ts` selects build number `7` and `runtimeVersion.policy = fingerprint`.
The already uploaded build 7 used the production profile/channel, so it cannot receive updates published only to `testflight`.
This cannot change build 5's embedded runtime `1.0.0` or add its missing widget.
No build, upload, channel/settings mutation, production OTA or Apple submission is authorized by this runbook.

During the next separately authorized build, retain the frozen source and installed lockfile, EAS build ID and output, actual IPA hash, embedded Expo.plist runtime/channel and Apple processing evidence.
On that exact clean source, evaluate `node scripts/deploy/native-fingerprint.mjs` inside the EAS production environment with `EXPO_NO_DOTENV=1` and without repository credentials.
Require its hash to equal the actual fingerprint runtime embedded in the IPA, then record that hash and package version in the channel's reviewed binary receipt.
Run `node scripts/deploy/native-compatibility.mjs --channel=testflight --production-env` with the same environment before adopting the new baseline.
Retain independent workflow-security review of the source-bound receipt.

`ota-policy.json` selects automatic `testflight` OTA after green main Verify, exact production deployment and production smoke.
The publication helper must still verify channel-to-branch isolation and the complete binary receipt before exporting or publishing.
Before any App Store launch, set `app_store_launched` to `true` in the same reviewed change; the policy refuses automatic `production` in that state.
Keep the production baseline bound to the actual App Store binary and the TestFlight baseline bound to its separate binary.
Production updates then require Dawit to dispatch Deploy from main with `approve_production_ota: true`, plus the existing `production-native` environment approval.
The manual path rechecks latest main push Verify, exact Vercel serving identity, production smoke and native compatibility before publication.
Both channels use the production EAS environment and publish iOS only.
Before and after publication, the helper verifies that the selected channel points only to its own named branch without a rollout; TestFlight publication also requires production to remain on its separate production branch.
The first OTA on an empty channel compares mobile inputs with its verified embedded binary source; later runs compare with the newest applied iOS update.

The existing `rollback.sh mobile` is production-only, and the bundle identity helper defaults to the historical production receipt.
For TestFlight recovery, the release owner must separately authorize a channel-specific recovery, retain the shared hold/lease protections and verify the TestFlight runtime and immutable manifest identity; do not run the production rollback against a TestFlight-only failure.

## Publication and recovery protections

The canonical production helper requires a clean commit on main's first-parent history, verifies source and production environment, and exports iOS only.
The helper fetches main under the release lease and rejects older commits whose bundle inputs differ from current main.
An integrated mobile commit remains publishable when a subsequent API-only commit advances main before its queued Deploy publishes.
Unmerged feature-branch parents of a merge are excluded from that main-line history.
Every surviving main Deploy attempts guarded iOS publication, including API-only pushes.
GitHub concurrency can replace a pending run even with cancellation of active runs disabled, so a per-push mobile filter cannot establish delivery.
The surviving push publishes its current main-line source and includes any mobile changes from replaced pending pushes.
Every surviving push runs production API smoke, including docs-only pushes that may incorporate replaced API changes.
Successful migration and successful smoke remain prerequisites, followed by the native/source/environment gates.
Both local and CI publication share an atomic GitHub ref lease at `refs/tags/fitsy-ios-ota-lock` with rollback.
A unique commit identifies each owner; only that owner deletes the lease.
Rollback opens its hold, waits for an active publisher to finish, then republishes and verifies its recovery group is newest while still holding the lease.
A waiting publisher sees the durable hold after acquiring the lease and skips publication.
Interrupted or uncertain EAS mutations retain the lease and fail closed.
For an abandoned lease, first verify the owner process and EAS mutation are finished and reconcile the served production group, then delete that exact lease ref before retrying recovery.
The release job needs contents-write permission only to coordinate this trusted main release lease.
Checkout does not persist its credentials; dependency installation and EAS CLI preparation run without release secrets.
Only the release helper receives the GitHub write token, and its Git fetch uses an ephemeral GitHub credential helper.
EAS subprocesses do not inherit that repository write token.
Before republishing, the rollback helper creates or reuses an open `release: iOS OTA rollback hold` issue.
CI and local publication read all open release issues through the GitHub API and skip publication while a hold exists.
Failure to read or establish the hold fails closed.
Close the hold only after repaired mobile source passes required checks and independent review and receives explicit production approval.
Unrelated main pushes never clear the hold.
Each publication retains an identity receipt derived from the immutable iOS manifest’s launch hash, asset hashes, runtime and configuration.
Group IDs, timestamps and download URLs are excluded so duplicate publications and republishing preserve bundle identity.
Default rollback scans the latest 20 groups under its lease, skips Android-only groups and identical iOS bundles, and chooses the first verified distinct earlier iOS bundle.
Missing or malformed manifest evidence and an exhausted duplicate history fail closed with the hold still open.
Supply an explicit known-good group when automatic selection cannot establish a distinct prior bundle.
The mobile rollback helper also republishes iOS only, including when the previous group contains both platforms.
There is no verified Android production binary, so this proof grants no Android publication authority.
Replacing the baseline requires actual EAS/Apple binary evidence and independent workflow-security review; a tag alone is insufficient.
Retain the prior baseline and release receipts in Git and on the owning issue.

Processing, OTA publication and observed device uptake are distinct outcomes.
This baseline does not submit to App Review, accept Apple agreements, release an App Store version or complete the human trial acceptance in #431.
The release packet and human approval requirements in #444 remain applicable.
