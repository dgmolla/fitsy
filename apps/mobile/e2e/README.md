# Native walkthrough helpers

The canonical scenario, ownership, evidence and publication procedure is in `docs/engineering/devops/shipping.md`.
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
