# Native walkthrough helpers

The canonical scenario, ownership, evidence and publication procedure is in `docs/engineering/devops/shipping.md`.
Inspect the dynamic selection with `npm run verify:sim-plan` from the repository root.
The maintained path-to-flow mapping lives in `scripts/verify/impact-plan.mjs`; extend it and its table-driven tests when adding screen coverage.
Mapped mobile and API contracts select their affected journeys together.
Shared behavior, native inputs and unmapped mobile-facing paths expand to the full flow set, and `needs-sim` forces flows for otherwise non-mobile changes.
The plan explains every omitted journey; explicit local scopes and flow lists cannot omit required coverage.
Every UI edit triggers local coverage: proven screen-local style/copy reuses a maintained flow through its mapped render assertion and saves a screenshot, behavior changes run affected E2E flows, and shared UI/app shells run the full suite.
Keep render checkpoints in `impact-plan.mjs` aligned with assertions in the maintained YAML flows.
`onboarding-assisted-targets` submits a calorie edit directly through Continue with the decimal keyboard open, then checks Back preserves the saved allocation.
Its preview comparisons use those saved calories and grams, including whole-gram rounding, for the real dev API request.
`onboarding-target-ranked-search` settles each previous field and clears generated values before typing, then saves with the decimal keyboard open and checks Back restores all four targets.
Its live ranked queries and preview assertions use that persisted allocation: 50 g protein, 44 g carbs and 14 g fat settle to 502 kcal.
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
If `log-meal` reaches `Welcome back.` with `Your Fitsy Pro subscription ended`, authentication succeeded but the required `entitled-dev` fixture has expired.
A `Dev Login Failed` alert requires correcting the fixture credentials bundled by owned Metro; an ordinary paywall after login requires an active `entitled-dev` account.
Prepare an active disposable account through the local fixture adapter before rerunning; retain the Search assertion and paid-access routing.
If XCTest reports `kAXErrorInvalidUIElement` while waiting for `welcome-login`, hierarchy inspection failed before Dev Login ran.
Preserve the command trace and startup screenshot, then recover through the existing simulator owner before rerunning the unchanged journey.
Billing journeys retain the starting states below, and Apple history transfer still requires separate real-store acceptance.
A local scope pass does not replace the source-bound final-candidate product-flow gate.
Inspect `npm run verify:product-plan` for the same affected journeys and their required MCP categories.
The final runner includes every selected journey automatically, adds explicitly requested diagnostic flows, and does not append unrelated cold-start or sign-in baselines.
Required YAML assertions remain mandatory; only explicit optional commands and conditional branches may be optional.
Final acceptance runs complete selected YAML journeys even when a development render smoke was sufficient for a local style check.
Reuse a compatible installed binary or a supported build; the shared binary cache is optional.
The normal `product-flow.mjs build <UDID> --test-store` command can import a verified [shared native artifact](../../../docs/engineering/devops/native-binary-reuse.md#shared-native-cache), while each run starts fresh owned Metro for this checkout.
After acceptance or failure, stop owned Metro with `product-flow.mjs stop-metro`, release the device lease, and shut down only the owned idle simulator through the lifecycle procedure.
If sandbox access prevents the canonical simulator lease or media process inspection, retain the failure and resume through the existing authorized host owner; a plan or fixture pass is not native acceptance.

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
Configured Dev Login accounts must already exist with the documented billing state; failed fixture logins preserve the login error and never attempt registration.
Set both credentials together in the runner and its owned Metro environment.
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

`onboarding-guided-preview` checks payment Back after fresh sign-in and after a second, already signed-in checkout, preserving the craving and all four meal targets without purchasing.
Its payment and return screenshots distinguish an exit offer from a successful preview return.
`components/OnboardingPaymentBack.test.tsx` exercises the real preview, sign-in, trial, reminder and payment screens with intact and deliberately removed native history, including both visible and hardware Back.
Owned continuations and cold payment entry retain their exit checks in `PaymentCompletion.test.tsx` and `PaymentPlanSelection.test.tsx`.
Run the complete candidate selection with `node scripts/sim/ci.mjs --scope=full --udid=<UDID>` using the configured journey fixtures; guided preview uses `unsubscribed-dev`.
The existing durable sim-stability owner runs the final clean three-run MAIN batch through `~/fitsy-refactor/sim-review/stability.sh 3` after protected integration; a branch replay does not establish MAIN stability.

Check saved flow syntax with `maestro check-syntax apps/mobile/e2e/flows/<flow>.yaml` before acquiring a simulator.
If Maestro cannot initialize its normal cache in a restricted workspace, set `JAVA_OPTS=-Duser.home=<owned-writable-temporary-directory>` for syntax checks.
This uses a separate Java cache without modifying the normal installation or changing the shell's home directory.
The canonical media check also requires host process-ownership inspection; a sandbox denial must be resolved through the existing host owner without disabling that preflight.
If XCTest setup reports `No space left on device`, recover eligible host resources before rerunning; `scripts/sim/ci.mjs` checks disk admission before driving any journey.

`menu-macro-serving` clears app data and keychain to preserve its anonymous starting state.
Its bounded startup retry waits for the launch animation and the original `Find meals that fit` screen before opening the restaurant.
Missing welcome UI or a genuine crash still fails; product interactions and the full flow are never retried.
`scripts/sim/ci.test.ts` protects that startup boundary, including the mandatory screen, timeouts and retry limit.

`chain-menu-serving` clears app and keychain state to prove anonymous menu access.
On a Debug dev-client build, clearing state can return to Expo's Development Build launcher; the flow selects local Metro before waiting for `welcome-start`.
Embedded builds skip that conditional launcher step, and startup retries never repeat menu or authentication actions.
After tapping a locked dish, assert the selected restaurant and `signup-apple`/`signup-google` controls because this entry uses contextual signup copy.
Keep checkout controls absent until authentication succeeds.
`components/ChainMenuServing.test.tsx` checks the saved flow's final selectors against the real menu and sign-in screens, while `scripts/sim/ci.test.ts` covers its launch contract and render-smoke consumer.
The Mac's advisory exclusions live outside this repository in `~/fitsy-refactor/sim-review/poller.mjs`; remove `chain-menu-serving.yaml` from `KNOWN_FAILING` after a passing native run of the repaired flow.
Remove `onboarding-target-ranked-search.yaml` (#525) from that same list after its repaired flow passes on the Debug dev build.

`onboarding-returning-preview` reconnects a cleared Debug client to local Metro before checking `welcome-start`.
Both Dev Login checkpoints wait for checkout or a completed authentication failure, reject `Dev Login Failed`, and require the real paywall before continuing.
Its original missing-logo capture contains `Dev Login Failed` with `Email already registered`: check the fixture credentials and the values bundled by owned Metro before investigating plan rendering.
The flow records a real decline, clears only the disposable keychain, and retains the anonymous preview, locked-meal, cancellation and cold-resume checks without purchasing.
`components/OnboardingReturningPreview.test.tsx` exercises the real sign-in, paywall and decline with a rejected fixture login followed by a corrected retry.
Run `node scripts/sim/ci.mjs --scope=flow --flows=onboarding-returning-preview --udid=<UDID>` with `unsubscribed-dev`, then remove `onboarding-returning-preview.yaml` (#527) from the Mac's `KNOWN_FAILING` list after a passing native run.

`reminders` uses `unsubscribed-dev` to check guest access, leaving without opt-in, native denial, grant and permission persistence after relaunch without purchasing.
After Dev Login completes, it opens notification settings and uses `reminders-enable`; it does not assume a paywall destination or an eligible trial offer.
The `/welcome/notification-permission` screen requires an active purchase and cannot supply this inactive account's permission coverage.
Keep the fixture's credentials in owned Metro as well as the runner environment; a `Dev Login Failed` alert indicates an authentication/setup failure, not a missing paywall plan.
Both permission resets reconnect a cleared Debug client to local Metro before checking the welcome screen.
`components/RemindersJourney.test.tsx` checks those startup steps and exercises the saved flow's sign-in continuation and opt-in control against real settings, preferences and scheduling for a never-subscribed account.
Run `node scripts/sim/ci.mjs --scope=flow --flows=reminders --udid=<UDID>` with the local fixture configuration, then remove `reminders.yaml` (#528) from the Mac's `KNOWN_FAILING` list after the repaired flow passes natively.

The assisted-targets journey also opens `/macro-setup`, asserts its daily editor and exercises Save and Skip; macro-setup render smoke stops at `macro-setup-save` on that screen.
Run the native accessibility helper regression tests from the repository root with `node --test apps/mobile/e2e/helpers/native-ax.test.mjs` when changing these helpers.

Mobile MCP text dumps include state names in their legend.
Use `isNativeFocused(dump, testID)` on a fresh observation before typing and `assertNativeValue(dump, testID, expected)` afterward.
These helpers inspect the exact element row and fail closed for missing or duplicate selectors.
They do not prove search results; assert the returned dish or empty-state recovery separately and retain the complete raw tool trace.

## Mixed-duration trial reminders

`paywall-mixed-trials-visual` covers annual two-day plus monthly seven-day trials and the reverse through the real three-screen onboarding journey.
Its shared helper checks the named reminder offer, the schedulable purchase default, live prices and renewal copy, plan switching, unavailable reminders for short trials with and without simulated opt-in, and the visual-only checkout guard.
Run it with `paywall-eligible-visual` through `scripts/sim/product-flow.mjs run <UDID> ... --mode=development` on an owned development build.
The `annual-short` and `monthly-short` visual parameters propagate unchanged between screens.
Every screenshot is labeled synthetic, and these flows request no notification permission, schedule nothing and cannot purchase or restore.
They do not establish eligible Apple or RevenueCat catalog acceptance.
When an actual eligible mixed catalog is available, separately verify both default purchases, plan switches, permission outcomes and the store-confirmed reminder schedule using that catalog and an eligible account.

## Preview Search highlight

`onboarding-search-highlight` follows real onboarding with meal prep selected so Search is the first preview tip.
It captures entry, settled pizza results and Back to Search, then verifies all five tips, completion, replay and Skip.
It asserts the 58-point highlight at entry, after results, on Back and on replay, and checks dismissal after completion and Skip.
The coachmark overlay owns the modal accessibility boundary; marking its tooltip modal also hides the sibling ring from iOS accessibility and Maestro.
`components/CoachMarks.test.tsx` queries the ring without hidden-element overrides through measurement and result relayout.
Clearing a Debug client's state can return to the Development Build launcher; the startup-only retry reconnects to local Metro before observing `welcome-start`.
`scripts/sim/ci.test.ts` checks that startup contract alongside the existing guest journeys.
Run it on both a small and normal supported iPhone through the canonical simulator runner.
After passing native runs, remove `onboarding-search-highlight.yaml` (#524) from `KNOWN_FAILING` in the Mac's external `~/fitsy-refactor/sim-review/poller.mjs`.
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

## Ambiguous legacy target recovery

`legacy-target-recovery-complete` and `legacy-target-recovery-filter` preserve their starting state.
Run each on a separately prepared, owned normal-size iPhone with an authenticated completed dev account, active access, no server allocation, and untagged per-meal protein 50, carbs 65, fat 20, calories 600 in the old macro-target key.
Use the historical client to prepare both origins before editing product code: edit a complete profile target from protein 40 to 50 while its old calorie field stays 600, and independently enter all four discovery constraints as 50/65/20/600.
Retain the historical build/source identity, visible save and cold reopen, raw storage, account identity, backend identity and screenshots separately for each origin.
Identical manually seeded values establish a fixture, not proof of the historical origin.
Do not clear app state or reuse an account whose server allocation would correctly take precedence over ownerless device data.

The complete choice must show 50/65/20/640 in discovery, Profile, and after another save and cold launch.
Capture the authenticated dev profile response after synchronization: daily protein 175, carbs 228, fat 70, calories 2242, source manual.
Daily calories derive from the rounded daily grams rather than multiplying 640 by 3.5.
The filter choice must keep 50/65/20/600 through save and cold launch, with no complete profile target or target PATCH.
Also capture the Profile recovery banner when a server allocation already exists, cancellation followed by recovery, and anonymous discovery recovery before sign-in.
Verify account switching separately: the restored target or filter belongs only to the account that made the choice, and a choice left open across an account switch must not save.
Retain screenshots of the choice and both recovered states for required UI review; simulator fixtures and component tests do not supply human UI approval or close #443 acceptance.

Preflight dependencies with the existing worktree setup procedure and acquire the simulator through `scripts/sim/sim claim` before driving either flow.
A mobile MCP device listing alone does not grant ownership or prove that the sandbox can run the canonical simulator caller.
If CoreSimulator or the ownership lock is denied, retain that failure and the missing native acceptance in the task handoff, run the available component/storage regressions, and resume native proof through the existing simulator owner when access is available.
