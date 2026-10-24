# Fitsy App Store listing draft

**TL;DR:** This is proposed copy; the actual Apple submission baseline and next candidate still require verification.

> **Status:** proposed, not ready to paste into App Store Connect
> **Last inspected:** 2026-10-24
> **Release packet:** [next-submission.md](../release/next-submission.md)

The March 24 draft was not evidence of submitted Apple metadata.
Its identity, privacy, screenshot, nutrition, location and reviewer-account assumptions are superseded by the review packet.
Do not publish metadata or submit for review until the human approves that completed packet and its exact candidate.
No version files or Apple values were changed by this preparation.

## Proposed fields

| Field | Proposed value or required verification |
| --- | --- |
| Name | `Fitsy` |
| Subtitle | `Meals that fit your macros` |
| Keywords | `macros,protein,restaurants,nutrition,meal planning,calories` |
| Bundle identity | Preserve `com.fitsy.mobile`, matching current config and the historical verified build-5 IPA; verify current ASC identity for app `6763851364` |
| SKU / categories / copyright | Read actual ASC values and propose any edits in the packet; do not infer them from the old draft |
| Version and build | Conditional `1.1.0` / `6` proposal in the packet, subject to actual last version and highest allocated build |
| Privacy policy URL | Proposed `https://fitsy.org/privacy`; verify reachable production content and actual data practices |
| Support URL | Proposed `https://fitsy.org/support`; verify content and monitored inbox |
| Marketing URL | Proposed `https://fitsy.org`; confirm production destination |
| Terms | `https://fitsy.org/terms`; reconcile current subscription disclosures before approval |
| Age rating / content rights / privacy answers | Complete current questionnaires and review actual SDK/data/content practices; old blanket answers are not approved |

## Description draft

Find restaurant meals that fit your protein, carb, fat and calorie targets.
Choose a goal, enter targets you already know, or use Fitsy's general planning recommendations.
Explore nearby meal picks and adjust your area manually when you prefer.
Edit calories and macros together, compare dishes, and save favorites with full subscription access.
Nutrition values include estimates and reviewed nutrition sources where available; they are approximate planning information, not medical advice.
Subscriptions renew automatically unless canceled through your Apple subscription settings.
Prices, billing periods and any eligible introductory offer appear before purchase.

Privacy: https://fitsy.org/privacy
Terms: https://fitsy.org/terms

The proposed What's New text and prerequisite-specific edits live only in the [release packet](../release/next-submission.md#proposed-app-store-copy).
Do not promise a fixed trial duration, price, meal count, complete coverage or a fitness outcome without current supporting evidence.
Fourteen days is the desired regular-plan catalog policy, not proof that any particular account receives a trial.

## App Store screenshots

Use the packet's [current artwork plan](../release/next-submission.md#artwork-and-device-evidence) and [Apple's current specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
The inspected requirements include a Dynamic Island medium-display iPhone set at `1179 × 2556` or `1206 × 2622` portrait pixels.
Verify the actual ASC slots, including the documented large-display fallback, before capture.
The old blanket “five screenshots at two required sizes” instruction is superseded.
Capture the accepted candidate's goal/target setup, real preview, post-fetch guidance, nutrition detail and linked editor.
No refreshed submission artwork is available in this draft.

## App Review Information

The packet contains proposed [reviewer instructions](../release/next-submission.md#reviewer-instructions-draft), with credential and production-access verification still open.
Current source exposes `fitsy://auth/reviewer` for allowlisted `appreview@fitsy.org`; this does not prove a working account or a paid subscription.
Never claim `review@fitsy.app` has an active subscription based on the old draft.
Keep actual credentials outside Git and supply them through ASC only after authorization.
Use a separate appropriate Apple billing test account to prove purchases, eligibility and restoration.
Location permission is optional when manual area entry is used.

## Data and declaration review

Macro targets do not remain only on-device: authenticated profile synchronization sends daily targets and supplied body/profile facts to `/api/user/profile`.
Review actual data collected by Supabase, RevenueCat, PostHog, notification/location features and the API, including account linkage, purpose, retention, deletion and SDK manifests.
Do not equate an estimate's high confidence with verified official nutrition.
Verify content rights, current age-rating answers, encryption, tracking and IDFA statements against the final binary and Apple's forms.
The account owner retains legal agreements and consequential account/declaration choices.
