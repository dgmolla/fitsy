# Fitsy 1.0.1 (13) - paste-ready App Store submission packet

**TL;DR:** Everything Dawit needs to submit version 1.0.1 build 13 is below; he does every App Store Connect step himself, and a few answers need his confirmation first.

Prepared 2026-11-17 for [#444](https://github.com/dgmolla/fitsy/issues/444), following Dawit's decision on [#943](https://github.com/dgmolla/fitsy/issues/943).
This is a review packet, not an upload, a submission or a release.
Every App Store Connect (ASC) read behind it was read-only; no version, build, metadata or answer was created or changed.
No credential, reviewer contact value or personal data is in this file; those stay in ASC.
The older working packet is [next-submission.md](next-submission.md); this file supersedes its candidate rows.

## 1. Binary identity (confirmed)

| Item | Value |
| --- | --- |
| Marketing version / build | `1.0.1` / `13` |
| EAS build | `21daa1ca-c7b7-425a-96c9-c4f66ee28a2a` (profile `testflight`, finished) |
| Apple build | `2ba4a3ce-e589-4417-86a9-995a05f83248`, processing `VALID`, uses non-exempt encryption `false`, in the Internal TestFlight group |
| IPA SHA-256 | `944ef9d77c1f077ae665ec0eea8d9f62e40498f5ce7dded787850c89fddf4a7b` |
| Source | main `bb84c55c71117cbbea1e5704120df584848f20dc` plus a local-only commit changing only `buildNumber` 12 to 13 (`ba5ddb8b5405ae39c14674f3dde78a6cf632f7a8`); the equivalent change is on main through [#949](https://github.com/dgmolla/fitsy/pull/949) |
| Full suite | `full-suite/green` is success on `bb84c55c` (static, all test groups, build); checked with `node scripts/deploy/green-main.mjs --check <sha>` |
| Native fingerprint / runtime | `3b44b178e61594bf6d817a16737229504b5bda7c`; channel `testflight` |
| Bundle / ASC app | `com.fitsy.mobile` / `6763851364` |

What this does not prove: a real-device pass on this build, a real Apple purchase, or Apple's acceptance.
The production-store check of billing is Dawit's TestFlight pass ([#431](https://github.com/dgmolla/fitsy/issues/431)).

## 2. Where ASC stands today (read-only, 2026-11-17)

- One App Store version exists: `1.0.0`, state `PENDING_DEVELOPER_RELEASE` (approved, never released), build 4 attached, manual release.
- Dawit's decision on #943: never release `1.0.0` build 4, and ship the next submission as `1.0.1`.
- Subscriptions in group `fitsy` are all `APPROVED`: `com.fitsy.mobile.monthly` (one month), `com.fitsy.mobile.yearly` (one year), `com.fitsy.mobile.yearly_discount` (one year).
- Existing en-US values: name, subtitle, keywords, promotional text, support, marketing and privacy URLs, copyright `2026 Fitsy`, release type `MANUAL`, categories Health & Fitness (primary) and Food & Drink (secondary).
- App Review information exists with a demo account marked required and notes set; their values were not read.
- Not readable through the API: App Privacy answers and screenshot slot contents.

## 3. Metadata to paste (en-US)

Keep unchanged unless a row says otherwise.

| Field | Value |
| --- | --- |
| Name | `Fitsy: Healthy Restaurants` (keep) |
| Subtitle | `Meals that fit your macros` (keep) |
| Keywords | `protein,nutrition,meal tracker,macro diet,calories,IIFYM,eat out,high protein,low carb,keto,bulking` (keep; 99 of 100 characters) |
| Promotional text | `Eating out shouldn't ruin your fitness goals. Fitsy ranks nearby LA restaurants by how well their meals fit your goals - chains and local spots.` (keep; editable any time without a new build) |
| Support URL / Marketing URL | `https://fitsy.org/support` / `https://fitsy.org` (keep) |
| Privacy Policy URL | `https://fitsy.org/privacy` (keep; see open item A about its content) |
| Copyright | `2026 Fitsy` (keep) |
| Release | Manually release this version (keep) |

### What's New in this version

```text
- Find restaurant meals on a map that fit your calorie and macro targets.
- Set your targets once, then edit calories and macros together; the other values follow.
- The search list uses the same controls as the map, and tapping the map's search bar opens the list with the keyboard ready.
- Pick your own area any time; a refresh no longer overrides it.
- Clearer subscription terms for the plan you choose, with optional reminders for eligible trials.
- Sign-in, subscription recovery and map fixes.
```

### Description

This replaces the current text, which still says the app is in beta, lists "AI confidence score" and "Cut, Maintain, or Bulk" presets, and does not mention the map-first search or linked editing.
Every feature below is confirmed in source on main `bb84c55c`; nothing promises a free trial or a price.

```text
Eating out shouldn't ruin your fitness goals.

Fitsy helps you find restaurant meals that fit your calorie and macro targets. Choose a goal, enter targets you already know or use Fitsy's general planning recommendations, and see nearby meals on a map or in a ranked list.

WHAT YOU GET
- A map-first search of nearby restaurants, chains and local spots
- Meals ranked by how well they fit your protein, carb, fat and calorie targets
- Linked editing: change calories or macros and the other values follow
- A breakdown for every dish, labeled as an estimate or from reviewed nutrition sources where available
- Pick your own area any time if you prefer not to share your location
- Save the meals you like
- Optional reminders for eligible trials

Available in Los Angeles. Nutrition values include estimates and are approximate planning information, not medical advice.

Fitsy Pro is an auto-renewable subscription. Prices, billing periods and any eligible introductory offer are shown before you subscribe. Payment is charged to your Apple ID and renews automatically unless canceled at least 24 hours before the period ends. Manage or cancel in your App Store account settings. Deleting your Fitsy account does not cancel your subscription.

Terms of Use: https://fitsy.org/terms
Privacy Policy: https://fitsy.org/privacy
```

### Screenshots

Dawit approved the five Debug Test Store captures in `~/fitsy-review/763b/` as the final set on 2026-11-16 (#881).
They are `1179 x 2556` opaque PNGs from main `507fa575`, which has the same app code as this build apart from the version string and build number.
Upload them in this order with the captions from [next-submission.md](next-submission.md#artwork-and-device-evidence): `01-map`, `02-targets`, `03-nutrition`, `04-search`, `05-editing`.
Open item D: confirm in ASC which display-size slot accepts `1179 x 2556`, because Apple's required slot can change.

## 4. App Review information

Contact name, phone number and email are values only Dawit can supply in ASC; they were not read and are not recorded here.
The existing demo account is marked required; confirm its credentials still sign in on build 13 before submitting (open item B).

Notes to paste (contains no credentials; the credentials go in ASC's own demo-account fields):

```text
Fitsy finds restaurant meals that match calorie and macro targets. Launch the app and choose a goal, then either enter known targets or use assisted setup. Allow location, or pick an area manually; the covered area is Los Angeles (for example Silver Lake, 90029). After the restaurant list loads, a short set of tips appears.

Preview access is limited. Opening full menus or saving meals leads to account and subscription access. To review full access, use the demo account in the fields above: open fitsy://auth/reviewer and sign in with it. This is a pre-approved full-access account, not a real Apple purchase.

To review purchases, use an Apple sandbox account: plans show their live terms, and an eligible plan shows its introductory offer. Cancel, restore and resubscribe all work. Reminders are optional.

Profile > Delete account removes the Fitsy account and its data; it does not cancel the Apple subscription, and the app says so.
```

## 5. App Privacy answers (from a source audit of main)

These are recommendations for Dawit to confirm; the Privacy Policy must match them (open item A).
Evidence is from `apps/mobile`, `apps/api` and `prisma/schema.prisma` on main; the data-use column uses Apple's purpose names.

| Data type (Apple category) | What the app sends | Linked to user | Tracking | Purpose |
| --- | --- | --- | --- | --- |
| Contact Info - Email Address | Sign-in email (Apple or Google); also sent to PostHog as a person property | Yes | No | App functionality, analytics |
| Contact Info - Name | Name from Sign in with Apple, stored on the account | Yes | No | App functionality |
| Health & Fitness - Health | Height, weight, birthday and sex when the user enters them; stored on the server | Yes | No | App functionality, personalization |
| Health & Fitness - Fitness | Activity level and goal; calorie and macro targets | Yes | No | App functionality, personalization |
| Location - Precise Location | Device coordinates sent as `lat` and `lng` to find nearby restaurants; no code stores them (server logs not audited) | Yes | No | App functionality |
| Location - Coarse Location | Rounded location from the uncovered-area waitlist, stored with the email only if the user taps Notify me | Yes | No | App functionality |
| Identifiers - User ID | Account id; used for sign-in, PostHog and RevenueCat | Yes | No | App functionality, analytics |
| Identifiers - Device ID | Expo push token, stored on the account | Yes | No | App functionality |
| Purchases - Purchase History | Subscription status and Apple transaction id via RevenueCat | Yes | No | App functionality |
| Usage Data - Product Interaction | PostHog events such as screen views, searches, saves and purchases checks, filtered to an allowlist | Yes | No | Analytics |
| User Content - Other User Content | Saved meals; feedback board posts | Yes | No | App functionality |
| Diagnostics - Crash Data | Sentry crash reports, scrubbed to exception type and code paths; native crashes include device model, OS and app version | No | No | App functionality |

Tracking: none. No App Tracking Transparency, IDFA, advertising SDK or data-broker SDK exists in the code, and PostHog runs identified-only with geo-IP disabled and no session replay.
Answer "No" to "Do you or your third-party partners use data for tracking".
Not verified: server-side request logs for coordinates, the map provider's data handling, third-party SDK privacy manifests, and the PostHog autocapture default.

## 6. Age rating

The stored answers say none of the following apply: health or wellness topics, medical or treatment information, user-generated content, unrestricted web access, alcohol references, contests, gambling or mature content.
Dawit decided on 2026-11-16 (10:40 PM PT, #953 item E) to use these answers instead:

| Question | Stored | Decided answer | Why |
| --- | --- | --- | --- |
| Health or wellness topics | No | **Yes** | The app turns height, weight and goal into calorie and macro targets |
| User-generated content | No | **Yes** | Every feedback submission is also a public post on the in-app feedback board, with a profanity filter up front |
| Alcohol, tobacco or drug references | None | **Infrequent or mild** | Restaurant search can show bars and liquor menus |
| Medical or treatment information | None | None | Estimates are labeled as planning information, not medical advice |

Everything else stays as stored.
The resulting rating is whatever Apple's questionnaire computes; it may rise above the current one.

**Finding that affects the user-generated-content answer:** the feedback board has no report or block controls.
Source on main has a profanity filter and votes (`apps/api/app/api/feedback/route.ts`, `[id]/vote/route.ts`) and no report or block endpoint, and `apps/mobile/app/feedback-board.tsx` has no such control.
Apple's user-generated-content rules expect a way to filter, report and block, so this is a likely review risk.
It needs a decision from Dawit: add report and block (an API change plus app code), or hide the public board for this version.
Tracked on #953.

## 7. Dawit's App Store Connect steps (he does these; no lane uploads, creates or submits)

1. Create a new iOS version `1.0.1` under Fitsy. Do not release `1.0.0` build 4; leave it as it is.
2. Paste What's New, Description and keep the other fields in section 3.
3. Upload the five screenshots from `~/fitsy-review/763b/` (see open item D).
4. In the Build section, select `1.0.1 (13)`, Apple build `2ba4a3ce`.
5. Answer the export-compliance question: the build declares no non-exempt encryption (`ITSAppUsesNonExemptEncryption` false; processing reports `usesNonExemptEncryption` false).
6. Fill App Privacy from section 5, then update the age rating from section 6.
7. App Review information: confirm contact details, confirm the demo account works on build 13, paste the notes from section 4.
8. Confirm the three subscriptions (all `APPROVED`) are attached or selectable for this version as ASC requires.
9. Confirm content rights, pricing and availability, and keep release type Manual.
10. Finish the real-device TestFlight pass on build 13 (sign-in, purchase or restore, delete account), then press Submit for Review.

## 8. Open items for Dawit

- **A. Privacy policy does not match the app.** A corrected draft is in [PR #955](https://github.com/dgmolla/fitsy/pull/955), not merged. `https://fitsy.org/privacy` lists only macro targets and saved items. It omits birthday, height, weight, sex, activity level, goal, push token and feedback posts. Its deletion text omits the other profile fields. It does not name Sentry, RevenueCat or Expo updates, and does not mention that native crash reports bypass the scrubber. Fixing legal text is Dawit's call; this packet does not edit it.
- **B. Reviewer contact and demo account.** Confirm the contact details, and that the demo credentials still work on build 13.
- **C. No in-app medical disclaimer.** The description says estimates are not medical advice, but the app has no matching text. Decide whether to add one before submitting.
- **D. Screenshot slot.** Confirm which ASC slot takes `1179 x 2556`.
- **E. Age-rating answers in section 6.** Decided; see the feedback-board finding there.
- **F. Real Apple billing test** on this build ([#431](https://github.com/dgmolla/fitsy/issues/431)).

## 9. What was and was not checked

Checked read-only: ASC versions, builds, review submissions, subscriptions, localized metadata, categories, the stored age-rating answers; source for data practices; build identity against the merged baseline receipt.
Not checked: App Review feedback text, the live Apple price and territory list, prior Apple messages, server request logs, the real-device pass, and the actual ASC screenshot slots.
