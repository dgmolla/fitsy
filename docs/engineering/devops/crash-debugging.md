**TL;DR:** Sentry receives sanitized JavaScript crash stacks and, since #832, native crash reports too; Axiom and PostHog retain monitoring and paging responsibilities.

# Crash debugging

> **Status:** living · **Last verified:** 2026-11-13

[Issue #747](https://github.com/dgmolla/fitsy/issues/747) holds activation, account ownership, received-event proof and release status.
Installing the SDK or passing local tests does not establish live Sentry delivery.

## Responsibilities and privacy

| System | Responsibility | Data |
| --- | --- | --- |
| Sentry | Group JS exceptions and native crashes, resolve code locations | JS: sanitized error class, code frames, debug IDs, release, dist and environment. Native: Sentry's standard native crash payload (device model/OS/app version, native stack trace, binary images) - see below |
| Axiom and GitHub Production Monitor | API health, failure rates and existing Slack paging | Existing bounded request/dependency telemetry |
| PostHog | Product analytics and existing client_error counts | Existing allowlisted properties, without crash messages or stacks |

The existing [monitoring contract](monitoring-alerting.md) continues unchanged.
Sentry adds no Slack integration, Replay, profiling, tracing, sessions, logs, feedback collection or Seer.
Only error events are sampled, at 100% for the small launch cohort; tracing/profile/replay sample options are absent and automatic collectors are disabled.
Review the actual Developer error quota after activation rather than enabling overage billing.

`packages/shared/src/utils/crashPrivacy.ts` reconstructs each outbound error from an allowlist.
It removes messages, custom exception names, user identity, request bodies/headers/URLs, breadcrumbs, tags, extras, contexts, attachments, stack locals, source context and unknown future SDK fields.
Only recognized source/bundle paths survive, with hosts, query strings, private device/container prefixes and local home directories removed.
Function identifiers and source coordinates remain for grouping and source-map resolution.
The synthetic `0.0.0.0` user IP prevents Sentry from inferring the mobile device's address, as described in [Sentry's React Native data collection documentation](https://docs.sentry.io/platforms/react-native/data-management/data-collected/).
Enable the project's IP-address scrubbing setting as defense in depth and inspect the received event before any broader use.

Native crash capture is enabled (Dawit, 2026-11-13, after #832's native `NSRangeException` would have been missed by JS-only Sentry).
`beforeSend`/`beforeBreadcrumb` do not run for native crash events - this is a documented, verified SDK limitation (the native layer strips JS-only callbacks before it starts and transports a captured crash before the JS engine runs), not something a config option closes.
Native crash reports therefore carry Sentry's standard native crash payload instead of the JS allowlist above: device model, OS version, app version, native stack trace and binary images for symbolication.
`sendDefaultPii: false` still applies at the native layer and suppresses IP/user-identifying data there; `attachScreenshot`, `attachViewHierarchy` and `attachThreads` are explicitly disabled rather than left to SDK defaults.
No `setUser`/`setContext`/`setTag` call exists anywhere in the app, so a native crash has no app-specific user data to carry regardless.
There is no custom native (Swift/Kotlin) sanitization layer; this is an accepted, informed tradeoff, not an oversight.
Missing DSNs leave runtime reporting inactive and do not affect app/API availability.
API capture covers uncaught Node request errors through Next's `onRequestError`; handled responses still use existing monitoring.
No browser/landing-page or Edge SDK is initialized.
The mobile SDK handles uncaught JS errors and rejections; the existing app error boundary explicitly captures render errors while preserving its recovery UI and PostHog count.

## Account and credential setup

Reuse an existing accessible organization and projects before creating anything.
Record the actual organization slug, project slugs, region, free plan/quota and retained human owner on #747 before activation.
The prepared fallback is organization `fitsy`, projects `fitsy-mobile` (React Native) and `fitsy-api` (Next.js), US region, Developer $0, and Dawit as the single retained owner.
These are proposed names, not evidence that those resources exist or are available.
Confirm Developer in the actual billing UI; a trial banner is not proof of the permanent free plan.
Do not accept terms, authorize new account access or enable paid products without the final human grant routed through root.

| Destination | Variables | Handling |
| --- | --- | --- |
| EAS Fitsy project, production environment | `EXPO_PUBLIC_SENTRY_DSN` for fitsy-mobile | Sensitive visibility; a DSN is necessarily public in the installed bundle |
| EAS Fitsy project, production environment | `SENTRY_ORG`, `SENTRY_PROJECT` for fitsy-mobile | Non-secret build metadata |
| EAS Fitsy project, production environment | `SENTRY_AUTH_TOKEN` | Sensitive visibility, non-public name, build/upload child processes only |
| Vercel fitsy-api, production and preview | `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` for fitsy-api | Encrypted environment records, no client prefix |
| Vercel fitsy-api, production and preview | `SENTRY_AUTH_TOKEN` | Encrypted build-only upload credential; never used by application runtime code |

Use separate revocable upload tokens for EAS and Vercel with Sentry's `org:ci` permission, scoped to the retained organization.
That scope supports source maps and releases; no event-read, issue-write, member administration, repository access or webhook integration is needed for uploads.
See [Sentry permission scopes](https://docs.sentry.io/api/permissions/).
Received-event inspection can use the owner's existing UI session without another API credential.
Store tokens only in EAS/Vercel, never tracked files, Expo `extra`, public variables, command arguments, logs or proof.
The public-environment guard rejects `AUTH_TOKEN` names and Sentry token prefixes even during deliberate keyless exports.

EAS `Secret` visibility cannot supply a local/CI EAS Update job.
The existing OTA caller needs authenticated, CLI-readable `Sensitive` values for `eas env:exec`, as documented by [Expo's environment usage guide](https://docs.expo.dev/eas/environment-variables/usage/).
This keeps the token in EAS storage and temporary build-process memory without adding a GitHub secret or a new workflow.
Use the existing `scripts/sync-eas-env.py` only for the public DSN and other public configuration; it rejects upload-token values.

## Release identity and verification

The Expo plugin and Metro serializer require a fresh native fingerprint and compatible TestFlight binary.
Use the existing serialized native build/upload and [post-submit transaction](ios-ota-baseline.md), then the existing TestFlight OTA caller.
Do not update the old binary with this SDK by bypassing the compatibility guard.
Native source maps upload through the Sentry Expo plugin on EAS Build.
The existing `scripts/deploy/ota.sh` runs the official Expo uploader through EAS `env:exec` for the exact exported iOS bundle/map, with a 120-second bound and private provider logs.
With no mobile DSN it performs no Sentry upload, preserving unrelated publication.
With a configured DSN, missing upload configuration, missing debug IDs or provider failure exits nonzero and retains the existing release lease for reconciliation of the already-published group.
The existing Deploy failure path reports that failure; do not interpret the partial publication as complete acceptance.
Sentry debug IDs link bundles to their uploaded maps independently of release names.

| Surface | Release | Dist | Environment |
| --- | --- | --- | --- |
| Mobile | `com.fitsy.mobile@<app-version>+<native-build>` | EAS Update UUID, or native build for embedded JS | `testflight`, `production`, or `development` |
| API | `fitsy-api@<VERCEL_GIT_COMMIT_SHA>` | `server` | Vercel environment |

Before dispatch, run the focused privacy/caller tests and spot-check an in-memory SDK envelope.
Use one constant synthetic `new Error('Fitsy Sentry verification')` with `Sentry.captureException` from a dev client or TestFlight diagnostic session and one from the Next API runtime.
Do not use a real request body, account, meal, nutrition value, address or credential in either exception.
Temporary diagnostic code must stay in the owned validation source; do not expose an unauthenticated production error-trigger endpoint.
Wait for `Sentry.flush` and then confirm both events in the actual Sentry Issues UI, including decoded application file/line, grouping, release, dist and environment.
Inspect the complete received event, not only its title; verify the allowlist, synthetic IP and absence of user/nutrition data.
Record source SHA, binary/runtime/update group, issue/event IDs, source-map status and the spot-check result on #747.
Remove temporary diagnostics before the shipping candidate and revalidate its source identity.

Verify and independent AI review are necessary but do not prove publication, physical-device uptake or crash-debugging effectiveness.
Retain exact selector output even though #747 explicitly excludes Simulator/StoreKit journeys.
Keep live acceptance and any access/terms boundary explicit until the actual receipt and release checks are complete.
