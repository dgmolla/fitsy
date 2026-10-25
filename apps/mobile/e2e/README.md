# Native walkthrough helpers

The canonical scenario, ownership, evidence and publication procedure is in `docs/engineering/devops/shipping.md`.
Inspect the dynamic selection with `npm run verify:sim-plan` from the repository root.
The maintained path-to-flow mapping lives in `scripts/verify/impact-plan.mjs`; extend it and its table-driven tests when adding screen coverage.
Unmapped mobile paths expand to the full flow set, and `needs-sim` forces flows for otherwise non-mobile changes.
Every UI edit triggers local coverage: proven screen-local style/copy reuses a maintained flow through its mapped render assertion and saves a screenshot, behavior changes run affected E2E flows, and shared UI/app shells run the full suite.
Keep render checkpoints in `impact-plan.mjs` aligned with assertions in the maintained YAML flows.
CI posts `Sim scope` on the PR head and uploads `selection.json` with scope, flows and render checkpoints.
The read-only classifier supplies data to the protected `sim-scope.yml` publisher; the bounded status description contains scope and flow count, and the poller reads exact names from the artifact.
Simulator runs locally on the maintainer Mac via the sim-review poller, which posts the Simulator status; merges wait for it when scope is not none.
The pre-push hook stays free of simulator execution.
Use `node scripts/sim/ci.mjs --scope=<none|smoke|flow|full> --flows=<comma-list> --udid=<UDID>` with environment configuration loaded from the Mac.
The runner uses saved Maestro YAML and the existing exclusive simulator lease; use Maestro MCP (`maestro mcp`) for interactive inspection.
It requires the current candidate installed through the canonical native procedure and refuses GitHub CI execution.
Full scope includes every saved flow, including `signin-options`, `paywall-access`, `onboarding-guided-preview` and `log-meal`.
`log-meal` verifies the existing bookmark-to-Saved journey because this checkout has no dietary meal log.
It requires a disposable entitled dev account with a completed profile and reads `${EXPO_PUBLIC_DEV_LOGIN_EMAIL}` and `${EXPO_PUBLIC_DEV_LOGIN_PASSWORD}` through the local runner.
Use the Debug build with owned Metro so native Dev Login consumes those same environment values.
It resets only the synthetic Grilled Chicken Bowl bookmark, saves the meal through the UI and verifies it in Saved after relaunch.
Billing journeys retain the starting states below, and Apple history transfer still requires separate real-store acceptance.
A local scope pass does not replace the source-bound final-candidate product-flow gate.

## Local journey fixtures

Full scope mixes entitled, never-subscribed, expired and recreated accounts, plus Test Store and Apple purchase histories.
Those states cannot share the authentication left by the preceding flow.
The saved YAML declares required starting fixtures with `fixture:` tags and compatible build stores with `store:` tags.
Set `FITSY_E2E_FIXTURES` to an absolute path to an untracked local JSON file before running an account-dependent selection.
The runner validates all required entries before acquiring a device or clearing app state.

```json
{
  "version": 1,
  "fixtures": {
    "entitled-dev": {
      "envFile": "/absolute/local/entitled.env",
      "prepare": ["/absolute/local/prepare-fitsy", "entitled-dev"]
    },
    "unsubscribed-dev": {
      "envFile": "/absolute/local/unsubscribed.env",
      "prepare": ["/absolute/local/prepare-fitsy", "unsubscribed-dev"]
    },
    "expired-subscription": {
      "envFile": "/absolute/local/expired.env",
      "prepare": ["/absolute/local/prepare-fitsy", "expired-subscription"]
    },
    "empty-store": {
      "envFile": "/absolute/local/empty-store.env",
      "prepare": ["/absolute/local/prepare-fitsy", "empty-store"]
    },
    "apple-history": {
      "envFile": "/absolute/local/apple-store.env",
      "prepare": ["/absolute/local/prepare-fitsy", "apple-history"]
    }
  }
}
```

Environment files may override only `EXPO_PUBLIC_` values and stay on the local machine.
The two dev-login fixtures require their own `${EXPO_PUBLIC_DEV_LOGIN_EMAIL}` and `${EXPO_PUBLIC_DEV_LOGIN_PASSWORD}` values.
The adapter receives its configured arguments followed by the flow name and owned simulator UDID, with the fixture's environment loaded.
It selects and installs a compatible candidate artifact through the canonical native commands and signs into the documented real account/store state.
Pre-provision actual purchases, expiry and account recreation through the product; the bounded selection/sign-in step has 60 seconds and must not fabricate receipts or database entitlement.
Preparation owns and releases its simulator lease before returning; it must leave no driver or Metro process running.
The runner then reacquires the device, validates the candidate/native/backend identity and allowed store, and starts owned Metro with that fixture's environment.
It retains an identity receipt per journey, stops owned Metro and restores the previous environment afterward.
An optional `default` entry can restore a baseline build/state before journeys without a `fixture:` tag.
All selected journeys still run; missing preparation or a store mismatch fails the selection.
Apple history transfer retains the real-store requirements below and cannot pass on a Test Store build.

```sh
export FITSY_E2E_FIXTURES=/absolute/local/fitsy-fixtures.json
node --env-file=apps/mobile/.env.development.local scripts/sim/ci.mjs --scope=full --udid=<UDID>
```

## Native helper checks

Check saved flow syntax with `maestro check-syntax apps/mobile/e2e/flows/<flow>.yaml` before acquiring a simulator.
If Maestro cannot initialize its normal cache in a restricted workspace, set `JAVA_OPTS=-Duser.home=<owned-writable-temporary-directory>` for syntax checks.
This uses a separate Java cache without modifying the normal installation or changing the shell's home directory.
The canonical media check also requires host process-ownership inspection; a sandbox denial must be resolved through the existing host owner without disabling that preflight.

`chain-menu-serving` clears app and keychain state to prove anonymous menu access.
On a Debug dev-client build, clearing state can return to Expo's Development Build launcher; the flow selects local Metro before waiting for `welcome-start`.
Embedded builds skip that conditional launcher step, and startup retries never repeat menu or authentication actions.
After tapping a locked dish, assert the selected restaurant and `signup-apple`/`signup-google` controls because this entry uses contextual signup copy.
Keep checkout controls absent until authentication succeeds.
`components/ChainMenuServing.test.tsx` checks the saved flow's final selectors against the real menu and sign-in screens, while `scripts/sim/ci.test.ts` covers its launch contract and render-smoke consumer.
The Mac's advisory exclusions live outside this repository in `~/fitsy-refactor/sim-review/poller.mjs`; remove `chain-menu-serving.yaml` from `KNOWN_FAILING` after a passing native run of the repaired flow.

The assisted-targets journey also opens `/macro-setup`, asserts its daily editor and exercises Save and Skip; macro-setup render smoke stops at `macro-setup-save` on that screen.
Run the native accessibility helper regression tests from the repository root with `node --test apps/mobile/e2e/helpers/native-ax.test.mjs` when changing these helpers.

Mobile MCP text dumps include state names in their legend.
Use `isNativeFocused(dump, testID)` on a fresh observation before typing and `assertNativeValue(dump, testID, expected)` afterward.
These helpers inspect the exact element row and fail closed for missing or duplicate selectors.
They do not prove search results; assert the returned dish or empty-state recovery separately and retain the complete raw tool trace.

## Preview Search highlight

`onboarding-search-highlight` follows real onboarding with meal prep selected so Search is the first preview tip.
It captures entry, settled pizza results and Back to Search, then verifies all five tips, completion, replay and Skip.
Run it on both a small and normal supported iPhone through the canonical simulator runner.
The entry screenshot records the first observed state; a fast response can finish before that capture, so it alone does not prove the loading transition.
Retain source-bound loading, transition and results captures with viewport and safe-area provenance when reproducing layout timing, and inspect equal clearance around the Search field and the tooltip position in each image.
Preserve original screenshots, approvals and raw failed evidence; obtain explicit UI approval for changed candidate states before final acceptance.

## Subscription Restore acceptance

`subscription-restore-expired` starts with an authenticated recreated Fitsy account on the ordinary paywall and an expired real Apple purchase belonging to the device's store account.
Prepare the purchase, expiry, account deletion and recreation through the actual product before running the flow.
Use the same Sign in with Apple identity, including its private-relay address when applicable.
The flow retains receipt and login state, restores through the visible control, checks Welcome back, and repeats the routing check after cold launch.
`subscription-restore-empty` is the negative control for a signed-in never-subscribed account whose store account has no Fitsy receipt.
`subscription-expired-routing` starts with an already expired subscription linked to the current Fitsy account and covers inactive Restore from Welcome back plus cold launch.
That same-account journey can use RevenueCat Test Store without requiring history transfer.
All flows require their documented starting state and fail if that state is absent.
Run simulator automation through the canonical procedure in the shipping contract; none of these flows resets billing state or fabricates receipts.
Use the same assertions as TestFlight walkthrough checkpoints when device automation is unavailable.

Capture the signed-in `/api/subscriptions/sync` verdict and freshness after Restore alongside the screen, binding them to the authenticated Fitsy user ID and candidate source without recording tokens.
Expired acceptance requires `synced: true`, `verdict: expired`, `active: false`, `stale: false`, and a recent `lastRcVerifiedAt`.
Also retain an active Restore or rebuy returning to its selected destination, foreground expiry, delayed synchronization and retry, and account-switch controls in the walkthrough.
RevenueCat Test Store cannot transfer history between app user IDs, so an empty Test Store Restore after recreation does not prove Apple receipt acceptance.
Use the compatible Apple TestFlight build and candidate OTA for that remaining store journey, and preserve its observed evidence separately from synthetic component tests.
