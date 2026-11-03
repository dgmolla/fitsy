# Simulator CI

The required `Simulator` check comes from `.github/workflows/simulator.yml` on every PR and main push.
An Ubuntu selector uses the complete Git comparison, including deletions and renames.
Only `apps/mobile/**`, `scripts/sim/**`, `scripts/verify/**`, the native fingerprint helper or this workflow starts the Mac.
Other changes pass on Ubuntu; failed classification, missing fixtures, failed flows, cancellation and an unexpectedly skipped Mac job never pass.

```mermaid
flowchart LR
  PR[PR or main push] --> Select[Ubuntu path selection]
  Select -->|unrelated| Result[Simulator check on Ubuntu]
  Select -->|mobile or simulator| Mac[One queued Mac job]
  Mac --> Cache[Expo fingerprint native cache]
  Cache --> Maestro[Current source Metro and Maestro]
  Maestro --> Cleanup[Stop processes, erase and shut down iPhone 15]
  Cleanup --> Result
```

PR pushes cancel superseded work on the same PR.
The repository-wide `fitsy-simulator` concurrency group queues different PRs with `queue: max`, allowing one Mac job at a time.
The Mac job has a 30-minute deadline, one Xcode build worker, one Metro worker, a 2 GB Node heap and a 768 MB Java heap.
Keep only one runner registered with `fitsy-sim` and leave the old local publisher paused.
Manual native work must respect the existing `scripts/sim/sim` claim; CI refuses to boot alongside another booted simulator.

Normal PRs run `cold-start-welcome`, `signin-options` and `paywall-access`, including real DEV sign-in and paid-access assertions.
Main and PRs labeled `full-sim` run every maintained flow compatible with Test Store, with no known-failure exclusions.
The `subscription-restore-expired` Apple receipt-history journey retains its separate manual acceptance in [the E2E guide](../apps/mobile/e2e/README.md#subscription-restore-acceptance); Test Store cannot prove Apple history transfer.
The label expands a relevant change's suite; it does not start a simulator for an unrelated change.
Full runs still fail if the deadline or any fixture/flow assertion fails.

## One-time Mac setup

1. Install Xcode and its iOS Simulator runtime, accept the Xcode license, and finish first launch.
   Install Node 22, CocoaPods, Java 17 or newer, Maestro, and Tesseract with English data.
   Verify `xcodebuild -version`, `pod --version`, `java -version`, `maestro --version` and `tesseract --version` from the runner account.
2. In GitHub, open **Settings > Actions > Runners > New self-hosted runner**, select macOS and the Mac's architecture, and follow GitHub's download/checksum instructions in a dedicated runner directory.
   Register using `./config.sh --url https://github.com/dgmolla/fitsy --labels fitsy-sim --name fitsy-mac` and enter the short-lived registration token interactively.
   Before starting this public repository's runner, set **Actions > General > Fork pull request workflows > Require approval for all external contributors**.
   A fork can edit its workflow, so the workflow's same-repository condition alone is not a host security boundary; do not approve fork execution on this Mac.
   Review and move needed fork changes to a trusted same-repository branch.
   Use a dedicated non-admin macOS account without production credentials or unrelated source checkouts.
3. From that directory, run `./svc.sh install`, `./svc.sh start`, then `./svc.sh status` to install and verify GitHub's launchd service.
   Configure the service's `.path` with the installed Homebrew, Java and Maestro executable directories, then restart it with `./svc.sh stop` and `./svc.sh start`.
   Keep the runner account logged in and the Mac awake while jobs execute.
   Use `./svc.sh stop` whenever the daily machine needs all its resources.
4. Create one dedicated **iPhone 15** in Xcode's Devices and Simulators, name it `Fitsy CI iPhone 15`, then shut it down.
   Copy its identifier from `xcrun simctl list devices available` into repository Actions variable `FITSY_SIM_UDID`.
   Do not select a personal simulator: CI erases this device's data after every job and reuses the same device next time.
5. Set the secrets below under **Settings > Secrets and variables > Actions**.
   Run a mobile PR once, then rerun unchanged native inputs to confirm a cache hit and current-source Maestro execution.
   Keep branch protection's required check named `Simulator`, with GitHub Actions as its source if the rule pins an app.
   Do not resume the old poller or manually post a success status.

GitHub documents [runner service installation](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application?platform=mac) and [concurrency queues](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
The pinned actionlint version predates `queue`; `.github/actionlint.yaml` suppresses only that unsupported-key diagnostic for this workflow, with the queue contract covered by the workflow tests.

## Actions secrets

| Name | Value |
| --- | --- |
| `DEV_SUPABASE_URL` | The `fitsy-dev` Supabase project URL; the runner rejects other projects. |
| `DEV_SUPABASE_ANON_KEY` | That project's anon or publishable key, never a service-role key. |
| `REVENUECAT_TEST_KEY` | The RevenueCat Test Store public SDK key beginning with `test_`. |
| `SIM_E2E_FIXTURES` | JSON mapping fixture names to `email` and `password`, described below. |

`SIM_E2E_FIXTURES` contains `unsubscribed-dev`, `entitled-dev`, `empty-store` and `expired-subscription`, each with a distinct disposable `@fitsy.dev` account.
Smoke needs only `unsubscribed-dev`; full needs all four.
Use this shape with actual credentials entered directly into GitHub: `{"unsubscribed-dev":{"email":"<disposable DEV account>","password":"<password>"},"entitled-dev":{"email":"<different DEV account>","password":"<password>"},"empty-store":{"email":"<different DEV account>","password":"<password>"},"expired-subscription":{"email":"<different DEV account>","password":"<password>"}}`.
Provision accounts and onboarding state through the existing DEV fixture procedure in the E2E guide.
The empty account must never have purchased; the expired account needs a genuinely expired Test Store purchase before the job starts.
The existing active-entitlement helper may renew the entitled account through a real simulated Test Store purchase and verifies the API's entitlement verdict.
No database credentials, entitlement fabrication, production data, Apple credentials, EAS publishing or App Store distribution are used.

Only the flow step receives runtime secrets; dotenv loading is disabled throughout.
The native cache contains the keyless Debug `.app`, keyed by Expo's iOS native fingerprint plus the Xcode SDK and build recipe.
It has no fallback key or cached test verdict.
Before installation, Expo regenerates public RevenueCat configuration in a disposable app copy and the runner preserves its simulator entitlements when signing it.
Each job starts Metro from the checked-out candidate with current fixture credentials.
Job logs name passed or failed flows; raw Maestro output and temporary bundles are removed during cleanup rather than uploaded with credentials.
The always-run cleanup stops owned Metro, erases and shuts down only the claimed device, and removes generated iOS/build/temp data without deleting the reusable device.
If the Mac loses power, stop the runner service, reconcile its existing simulator claim, shut down that dedicated device and restart the service before rerunning the failed check.
