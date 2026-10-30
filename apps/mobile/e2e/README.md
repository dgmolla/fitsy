# Native walkthrough helpers

The canonical scenario, ownership, evidence and publication procedure is in `docs/engineering/devops/shipping.md`.
Inspect the dynamic selection with `npm run verify:sim-plan` from the repository root.
The maintained path-to-flow mapping lives in `scripts/verify/impact-plan.mjs`; extend it and its table-driven tests when adding screen coverage.
`signin-options` also opens the documented reviewer deep link and verifies that an ordinary email cannot submit reviewer credentials.
Mapped mobile and API contracts select their affected journeys together.
Shared behavior, native inputs and unmapped mobile-facing paths expand to the full flow set, and `needs-sim` forces flows for otherwise non-mobile changes.
The plan explains every omitted journey; explicit local scopes and flow lists cannot omit required coverage.
Every UI edit triggers local coverage: proven screen-local style/copy reuses a maintained flow through its mapped render assertion and saves a screenshot, behavior changes run affected E2E flows, and shared UI/app shells run the full suite.
Keep render checkpoints in `impact-plan.mjs` aligned with assertions in the maintained YAML flows.
`onboarding-assisted-targets` submits a calorie edit directly through Continue with the decimal keyboard open, then checks Back preserves the saved allocation.
Its preview comparisons use those saved calories and grams, including whole-gram rounding, for the real dev API request.
`onboarding-target-ranked-search` settles each previous field and clears generated values before typing, then saves with the decimal keyboard open and checks Back restores all four targets.
Its live ranked queries and preview assertions use that persisted allocation: 50 g protein, 44 g carbs and 14 g fat settle to 502 kcal.
`onboarding-guided-preview` and `onboarding-search-highlight` also blur through each field's label before focusing the next generated value.
Calorie blur can update protein after iOS has selected it, collapsing the selection and leaving generated digits behind when Maestro backspaces.
`OnboardingTargetEnergy.test.tsx` replays these saved commands against the real tuning screen with that native focus/blur order and checks the persisted targets.
Both `shuffle` and `meal-target-energy-sync` dismiss the meal editor through `helpers/dismiss-meal-targets.yaml`, which taps the exposed backdrop gutter and requires the modal to disappear.
The backdrop selector spans the full screen; its center is covered by the editor and can decrement carbs instead of closing.
`FilterPopupDismissFlow.test.tsx` checks both callers against the failed native capture's hit bounds, while `DiscoveryPerformance.test.tsx` replays the helper and requires the retained hero and zero extra card renders.
All seven onboarding journeys open the area chooser through `helpers/open-location-picker.yaml`, which waits for an enabled control and requires the neighborhood sheet with at most two taps.
`retryTapIfNoChange` can accept press feedback or unrelated hierarchy changes while the sheet stays closed; the helper retries only this idempotent action against its required outcome.
`onboarding-out-of-area` retains its separate sheet assertion, DTLA selection, authenticated coverage and cold-start persistence checks.
`OnboardingNavigationLocation.test.tsx` replays its recovery against the real location, waitlist and goal screens, including a cancelled first touch and a permanently unresponsive chooser that must fail without selecting an area or joining the waitlist.
Both out-of-area cold resumes retry only bounded animation and accessibility observations before requiring the persisted waitlist or goal screen.
`scripts/sim/ci.test.ts` exercises transient XCTest reads and rejects a permanently unavailable hierarchy or an incorrect resumed screen without relaunching or clearing app state.
`paywall-live-terms` reconnects a cleared Debug client to local Metro, then uses semantic controls throughout live purchase recovery.
After Test Store cancellation, it requires the discount modal to disappear before retrying a failed purchase; the welcome screen's warning-dismissal coordinate would tap Not now here and reopen the modal.
`PaymentCompletionCheckout.test.tsx` replays those saved recovery commands against the real paywall and native SDK boundary, retaining the cancellation, safe failure message and incomplete-onboarding assertions.
CI posts `Sim scope` on the PR head and uploads `selection.json` with scope, flows and render checkpoints.
The read-only classifier supplies data to the protected `sim-scope.yml` publisher; the bounded status description contains scope and flow count, and the poller reads exact names from the artifact.
Simulator runs locally on the maintainer Mac via the sim-review poller, which posts the Simulator status; merges wait for it when scope is not none.
The pre-push hook stays free of simulator execution.
Use `node scripts/sim/ci.mjs --scope=<none|smoke|flow|full> --flows=<comma-list> --udid=<UDID>` with environment configuration loaded from the Mac.
Add `--record-video` or set `FITSY_SIM_RECORD_VIDEO=1` for optional short Slack previews beside the screenshots; recording failures do not fail a journey.
See [runner controls](../../../scripts/sim/native-runner-controls.md#optional-slack-previews) for bounds and the existing Mac poller integration.
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
For a subscription transport-failure diagnostic, start on the recovery screen with the same failure on status and sync, then run `helpers/subscription-check-retry.yaml` with `SUBSCRIPTION_ERROR_COPY` set to the expected copy.
`SubscriptionCheckNavigation.test.tsx` replays its saved assertions through the real router, provider and API client for 503, network failure and 429, including a failed retry followed by successful recovery.
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

The `map-search` and `map-search-location-denied` journeys require an iOS Debug binary rebuilt with the Expo-compatible `react-native-maps` dependency.
An OTA cannot add this native module to an older binary.
Both flows use the existing `entitled-dev` fixture and real search/shuffle API with no purchases or remote flag changes.
The boolean PostHog `map-search` flag enables the experiment only in development iOS builds; `mapDebug=1` is the local walkthrough opt-in.
Production builds and Android ignore both opt-ins and keep the list.
The first flow opens a pin, enters the restaurant menu, searches pizza, edits meal targets, switches map/list without losing state, shuffles, and clears search.
The second launches with location denied, requires the existing Los Angeles fallback chip, selects Hollywood, and repeats search and view switching.
Both map journeys submit the single-line search field with `pressKey: Enter`, which uses its native Search return key to dismiss the keyboard.
The detail round trip taps `restaurant-back`; generic Maestro `back` does not activate the iOS screen's custom Back control.
Map filter assertions require the chip ID and its exact accessibility label, such as `map-filter-protein` with `Edit protein grams, 40`.
An explicit label hides the nested `40g protein` text from iOS accessibility; `DiscoveryMap.test.tsx` exercises the saved selectors against the rendered controls after switching views, editing targets and shuffling.
Dense photo pins overlap, and MapKit can dispatch Maestro's coordinate tap to a neighboring pin despite the requested accessibility ID.
Both journeys retain pin-to-preview coverage; `map-search` compares toggle and shuffle results through `helpers/map-first-spot.yaml`, which closes any preview and uses the existing carousel to require the first result.
The real-screen regression replays that helper with different native pin hit targets and a previously selected restaurant, requiring the same first result after toggling and a new one after shuffling.
`helpers/map-search-setup.yaml` shares the authenticated API preflight and bounded startup reconnection.
Maestro passes `launchApp.permissions` values to iOS without expanding variables, so this helper selects literal `inuse` or `never` launches through `runFlow.when.true`.
The installed iOS location driver rejects generic `allow`/`deny`; `inuse` grants foreground location and `never` exercises denial.
Keep both permission scenarios covered by `scripts/sim/ci.test.ts` before host replay.
The planner and product acceptance entrypoint consume both saved flows; the native dependency change requires the full selection.
Run `lockf -t 3600 ~/fitsy-refactor/loop/sim.lock node scripts/sim/ci.mjs --scope=full --udid=<owned-UDID>` with the documented host fixture configuration.
If the managed worker cannot open that shared lock, stop native execution and preserve the exact denial for the existing host owner.
Do not substitute another lock or drive the device through another tool; YAML parsing and component tests do not establish a native pass.

For syntax-only checks in a restricted worker, Maestro may fail while changing permissions on its shared `~/.maestro/deps` cache.
The installed CLI supports `MAESTRO_OPTS="-Duser.home=$PWD/.evidence/maestro-runtime" maestro check-syntax apps/mobile/e2e/flows/shuffle.yaml` to put its Java runtime cache inside the owned checkout without changing `HOME` or shared binaries.
This validates the saved YAML with Maestro's parser; it does not grant CoreSimulator access or establish native acceptance.

Keep `dev.fitsy.org` pinned to the `dev` branch, which mirrors `main`.
For a PR with API, shared-contract or schema changes, configure `EXPO_PUBLIC_API_URL` to that PR's Ready `fitsy-api` Vercel preview in the `dawits-projects-74b6e00f` team.
The same origin must reach owned Metro, every account fixture, Maestro's `-e EXPO_PUBLIC_API_URL=...`, and the final evidence check.
The canonical runners pass that Maestro argument explicitly and disable Expo dotenv overrides for owned Metro.
An external host runner must also set `EXPO_NO_DOTENV=1` when starting Metro so a checkout's `.env.development.local` cannot restore the stable dev URL.
The external poller's [backend-selection hook](../../../scripts/sim/native-runner-controls.md#host-backend-selection) discovers an exact-head Ready preview when stable dev has different API contents and checks it before native preparation.
Confirm that this hook is installed and its `backend-identity.json` names the selected origin; repository-only fixes cannot change the host's loaded environment.
Vercel's immutable URL can use `fitsy-<hash>` even though the verified project is `fitsy-api`; both saved helpers accept that same host-verified origin.
If backend selection returns empty output from a Mac temporary checkout, run the selector regressions through its `/var` to `/private/var` path alias before another native attempt.
`helpers/data-api.mjs` and `helpers/shuffle-subscriber.mjs` require that configured origin and refuse production, unrelated projects and URLs containing credentials, paths or query strings.
All saved API request paths are relative, so helpers cannot silently probe stable dev while the app uses a preview.
The native runner verifies that origin's Ready, nonproduction `fitsy-api` deployment and candidate API/shared/schema contents, then pins its deployment ID through acceptance and publication.
Account fixtures cannot override the run's selected origin; omit `EXPO_PUBLIC_API_URL` from fixture environment files or give every fixture the same value.
For a direct Maestro diagnostic, pass the same `-e EXPO_PUBLIC_API_URL=...` explicitly; a shell variable alone does not establish Maestro's script variable.
Do not merge early, reassign the stable dev domain or remove assertions to satisfy Simulator.
The helper probes missing-token and invalid-token requests before login; an anonymous 200 means the deployed backend still lacks the candidate auth behavior.
Every caller immediately requires 401/401 and successful fixture login through a labelled assertion that reports all three HTTP statuses.
The helper returns without logging in when either auth probe fails, leaving that assertion to fail normally instead of throwing a Graal exception that Maestro truncates into invalid command JSON and an unknown JUnit error.
Retain that failure and correct the deployment through the existing host owner before replaying the selected journeys.
The helper also writes one `[data-api]` JSON line containing only numeric HTTP statuses because Maestro's command/JUnit artifacts can retain unresolved assertion labels.
An invalid-session probe or login returning 503 with `Service unavailable` can mean the deployed shared rate-limit store is missing or unavailable, even while health reports a connected database.
Check the deployment's `[rate-limit] Shared store unavailable` runtime log and the nonproduction `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` configuration through the [shared-quota recovery contract](../../../docs/engineering/backend/api-rate-limits.md#verification-and-recovery).
The existing host delivery owner must restore the nonproduction store configuration, redeploy the candidate and verify the same preflight before replaying; preserve fail-closed behavior and every journey assertion.
The Vercel build now validates the same shared-store configuration as request handling before migrations or builds, so missing credentials withhold deployment instead of producing another Ready API that cannot authenticate.
Retain a required new-provider terms/access grant for the account owner when provisioning is necessary; the existing deployment needs a fresh candidate redeploy after the dedicated nonproduction configuration is restored.
Retain the failed run and the recovered run separately; changing deployment configuration does not require a product-code workaround or establish a passing native journey.

`shuffle` requires a populated dev backend, `entitled-dev` and a Debug Test Store build.
It signs the entitled fixture into the dev API and checks normal and shuffled search pages, a changed restaurant set and persisted RevenueCat proof before mobile launch can synchronize the subscription.
Its `helpers/shuffle-subscriber.mjs` helper keeps tokens and credentials out of Maestro output, uses the app's configured nonproduction origin, and rejects a demo bypass without actual subscription proof.
Before selection it captures the public health deployment SHA and requires an authenticated invalid shuffle option to return 400.
An older search API can pass the auth probes yet silently ignore shuffle options and return the same ranked page with HTTP 200.
The saved flow reports that incompatible deployment explicitly and retains each access, nutrition, subscription-proof and changed-list assertion with diagnostic values and result counts.
Use the PR preview configuration above; a feature-branch mobile bundle alone cannot establish shuffle behavior.
It chooses DTLA and independent targets of 600 kcal, 40 g protein, 60 g carbs and 20 g fat, then taps the small Shuffle icon in the main search field twice.
The button fetches and replaces the restaurant page through the same search endpoint, preserving query, targets, area and access rules.
Pagination continues in the returned seeded order.
The flow compares the actual hero card text before and after each completed request, without expecting a specific restaurant or dish, and captures `shuffle-search` showing the button and results for Slack evidence.
The Debug-only `shuffleDebug=1` search parameter explicitly enables the icon without changing PostHog flags or entitlement.
Production builds ignore that parameter and require the PostHog boolean flag `shuffle` to be `true`.
There is no separate pick panel, Shuffle again, View menu, or Shuffle-specific loading, error, or empty state.
The button is disabled while search is pending or refreshing, or when the current list is empty.
`components/DiscoveryShuffle.test.tsx` exercises the real search screen and the saved flow's result assertions, including repeated taps, query-only search, rollout, empty results, and locked cards.
`components/DiscoveryRequests.test.tsx` covers cancellation of old pagination, seeded pagination, recent restaurant exclusions within the encoded URL budget, retry after network failure or timeout, and replacement by a new search.
`lib/shuffleSubscriberFlow.test.ts` exercises the saved search and shuffle preflight, stale-deployment diagnostics, its flow assertions, inactive or missing proof, authentication failure, and credential-output boundaries.
Run it through `node scripts/sim/ci.mjs --scope=flow --flows=shuffle --udid=<UDID>` with the local fixture configuration.
The planner expands this request when the candidate also affects shared UI or other journeys.

`onboarding-guided-preview` signs in before location lookup and checks payment Back after both checkout entries, preserving the craving and all four meal targets without purchasing.
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

`menu-macro-serving` clears app data and keychain, proves unauthenticated API rejection, and signs in before inspecting the free menu sample.
Its bounded startup retry waits for the launch animation and the original `Find meals that fit` screen before opening the restaurant.
Missing welcome UI or a genuine crash still fails; product interactions and the full flow are never retried.
`scripts/sim/ci.test.ts` protects that startup boundary, including the mandatory screen, timeouts and retry limit.

`chain-menu-serving` clears app and keychain state, checks the authenticated API contract, and requires account sign-in before the menu sample.
On a Debug dev-client build, clearing state can return to Expo's Development Build launcher; the flow selects local Metro before waiting for `welcome-start`.
Embedded builds skip that conditional launcher step, and startup retries never repeat menu or authentication actions.
The protected deep link first shows `signup-apple`/`signup-google` and keeps plans hidden.
After authentication, tapping a locked dish opens subscription plans; being signed in does not grant paid menu access.
`components/ChainMenuServing.test.tsx` checks the saved flow's final selectors against the real menu and sign-in screens, while `scripts/sim/ci.test.ts` covers its launch contract and render-smoke consumer.
The Mac's advisory exclusions live outside this repository in `~/fitsy-refactor/sim-review/poller.mjs`; remove `chain-menu-serving.yaml` from `KNOWN_FAILING` after a passing native run of the repaired flow.
Remove `onboarding-target-ranked-search.yaml` (#525) from that same list after its repaired flow passes on the Debug dev build.

`onboarding-returning-preview` reconnects a cleared Debug client to local Metro before checking `welcome-start`.
Both discovery Dev Login checkpoints wait for the authenticated location screen and reject `Dev Login Failed`.
After cancelling anonymous return, the flow signs back in and selects a goal before reopening the goal-dependent nutrition context screen and preview.
Its original missing-logo capture contains `Dev Login Failed` with `Email already registered`: check the fixture credentials and the values bundled by owned Metro before investigating plan rendering.
The flow records a real decline, clears only the disposable keychain, and retains unauthenticated preview rejection, locked-meal, cancellation and cold-resume checks without purchasing.
`components/OnboardingReturningPreview.test.tsx` exercises the real sign-in, paywall and decline with a rejected fixture login followed by a corrected retry, plus the saved cancellation-to-preview sequence through real screens.
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

## Data authentication

Onboarding and menu journeys use the real `unsubscribed-dev` fixture before requesting live restaurant data.
`helpers/discovery-signin.yaml` checks Apple/Google availability and hidden plans, uses Dev login, and waits for the protected destination.
It does not grant an entitlement or purchase anything.
`helpers/data-api.mjs` probes missing/invalid-session requests, obtains a session only after both return 401, and makes the oracle requests with a Bearer token.
Each saved-flow caller then asserts both 401s and the successful login, reporting the HTTP statuses in its assertion label.
Only status and JSON bodies reach Maestro output; credentials and tokens remain inside the script.
Every oracle flow reads the configured `EXPO_PUBLIC_DEV_LOGIN_EMAIL/PASSWORD`; owned Metro must use the same fixture.
`lib/dataApiFlow.test.ts` executes the saved helper, covers login failure, and rejects new direct restaurant requests in maintained YAML flows.
`lib/api.auth.test.ts` covers token attachment, account cache isolation and sign-in recovery.

A restricted worker that cannot open local ports or access CoreSimulator must retain that failure and the planned scope for the existing host owner.
Run the canonical `node scripts/sim/ci.mjs --scope=full --udid=<owned-UDID>` on the authorized host against the candidate backend and Metro source.
Syntax checks and component tests do not establish a passing native journey or deployed 401s.

## Mixed-duration trial reminders

`paywall-mixed-trials-visual` covers annual two-day plus monthly seven-day trials and the reverse through the real three-screen onboarding journey.
Each catalog clears app state and keychain once, then retries only bounded startup observations and conditional local Metro reconnection before requiring `welcome-start`.
The second catalog can otherwise hit XCTest `kAXErrorInvalidUIElement` while the welcome screen animates in; that is an accessibility read failure before the trial journey starts.
Permanent hierarchy failures and an incorrect screen still fail, and billing actions and outcome assertions never run inside the startup retry.
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
It also leaves win-back for sign-in and returns with the same expired account, retaining win-back routing while optional restaurant requests are cancelled.
That same-account journey can use RevenueCat Test Store without requiring history transfer.
All flows require their documented starting state and fail if that state is absent.
Run simulator automation through the canonical procedure in the shipping contract; none of these flows resets billing state or fabricates receipts.
Use the same assertions as TestFlight walkthrough checkpoints when device automation is unavailable.

Capture the signed-in `/api/subscriptions/sync` verdict and freshness after Restore alongside the screen, binding them to the authenticated Fitsy user ID and candidate source without recording tokens.
Expired acceptance requires `synced: true`, `verdict: expired`, `active: false`, `stale: false`, and a recent `lastRcVerifiedAt`.
Also retain an active Restore or rebuy returning to its selected destination, foreground expiry, delayed synchronization and retry, and account-switch controls in the walkthrough.
RevenueCat Test Store cannot transfer history between app user IDs, so an empty Test Store Restore after recreation does not prove Apple receipt acceptance.
Use the compatible Apple TestFlight build and candidate OTA for that remaining store journey, and preserve its observed evidence separately from synthetic component tests.
