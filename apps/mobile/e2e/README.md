# Native walkthrough helpers

The canonical scenario, ownership, evidence and publication procedure is in `docs/engineering/devops/shipping.md`.
Inspect CI's dynamic selection with `npm run verify:sim-plan` from the repository root.
The maintained path-to-flow mapping lives in `scripts/verify/impact-plan.mjs`; extend it and its table-driven tests when adding screen coverage.
Unmapped mobile paths expand to the full flow set, and `needs-sim` forces flows for otherwise non-mobile changes.
Every UI edit triggers CI coverage: proven screen-local style/copy reuses a maintained flow through the mapped render assertion and saves a screenshot, behavior changes run affected E2E flows, and shared UI/app shells run the full suite.
Keep render checkpoints in `impact-plan.mjs` aligned with assertions in the maintained YAML flows; missing checkpoints fail before a simulator is created.
CI compares scope, mode, flows and checkpoints with classification; the pre-push hook stays free of simulator execution.
CI execution does not replace the local source-bound product-flow gate.
Hosted billing setup and the explicit Apple-only coverage policy live in `scripts/sim/hosted-journeys.mjs`, consumed by `scripts/sim/ci.mjs`.
Before each hosted Restore journey, CI clears app storage and keychain, signs in through `setup/billing-signin.yaml`, and asserts the required paywall or Welcome back starting screen.
The empty and expired fixtures use distinct disposable Test Store accounts; the runner restarts its owned Metro when switching the bundled Dev login credentials.
CI verifies each account through the real dev login and subscription-sync APIs before building and rechecks the billing fixture immediately before its journey.
Prepare the expired account's same-account purchase and expiry through the real Test Store product, then configure `FITSY_SIM_EXPIRED_LOGIN_EMAIL` and secret `FITSY_SIM_EXPIRED_LOGIN_PASSWORD` alongside the ordinary never-subscribed account.
Missing credentials, incorrect subscription history, stale verdicts and failed native assertions fail execution.
`subscription-restore-expired` requires Apple history transfer and runs separately through the local product-flow acceptance procedure below.
CI prints this required, unexecuted Apple obligation and retains it in `selection.json` and its result; a hosted pass supplies no Apple acceptance evidence.
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
