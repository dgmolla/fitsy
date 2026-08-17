# Launch waitlist

Capture out-of-area users during onboarding and notify them when Fitsy launches in their city.
Both push and email are sent at notify time; email is the durable channel.
Opt-in only — no data stored until the user taps "Notify me at launch."

## Flow

```mermaid
sequenceDiagram
    participant App as Mobile app
    participant API as fitsy-api
    participant DB as Postgres
    participant Expo as Expo Push
    participant Resend as Resend (email)

    App->>API: location preview (onboarding)
    API-->>App: empty result — out of area
    App->>App: show out-of-area screen

    Note over App: user taps "Notify me at launch" (explicit opt-in)
    App->>API: POST /api/waitlist { lat, lng }  (authed)
    API->>DB: upsert LaunchWaitlist { userId, email, coarse lat/lng }
    Note over API,DB: coords rounded to ~1 decimal place (city precision) before storage

    Note over API: operator calls when a city goes live
    API->>API: POST /api/internal/waitlist/notify { lat, lng, radiusMiles?, city?, dryRun? }
    Note over API: CRON_SECRET auth
    API->>DB: fetch unnotified LaunchWaitlist entries within radius
    API->>Expo: send push notification (User.pushToken)
    API->>Resend: send marketing email (account email)
    Note over Expo,Resend: both channels attempted; notifiedAt set if either succeeds
    API->>DB: set LaunchWaitlist.notifiedAt (idempotent re-runs skip already-notified)

    Note over App,Resend: unsubscribe path (email only)
    Resend-->>App: marketing email contains /unsubscribe?u=<userId>&t=<hmac>
    App->>API: GET /unsubscribe?u=...&t=... (confirm page, no mutation)
    App->>API: POST /unsubscribe { u, t } (user submits confirm form)
    API->>DB: set User.emailOptOutAt = now()
    Note over API: future marketing emails to this user are silently skipped
```

## Pieces

### Routes

- `POST /api/waitlist` (authed) — stores account email and a coarse, city-level location.
  Upserts by user so it never duplicates.
  Coords are rounded to ~1 decimal place before storage.

- `POST /api/internal/waitlist/notify` (CRON_SECRET) — run once when a city launches.
  Accepts `{ lat, lng, radiusMiles?, city?, dryRun? }`.
  With `dryRun: true` it returns the count of users who would be notified without sending anything.
  Idempotent: entries with `notifiedAt` already set are skipped.
  Sets `notifiedAt` when either push or email succeeds.

- `GET /unsubscribe` — renders a confirmation page with a button.
  Performs no mutation (safe for mail-scanner prefetch).
  Validates the HMAC token before rendering.

- `POST /unsubscribe` — processes the unsubscribe.
  Re-validates the HMAC token, then sets `User.emailOptOutAt`.
  Marketing email stops; transactional and account messages are unaffected.

### Libraries

- `lib/marketingEmail.ts` — wraps Resend.
  Injects List-Unsubscribe and List-Unsubscribe-Post headers (RFC 8058 one-click).
  Appends unsubscribe link and physical postal address to every message.
  Fails closed: throws if `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET`, or `FITSY_POSTAL_ADDRESS` is missing.
  Skips send (returns early) if `User.emailOptOutAt` is set.

- `lib/launchPush.ts` — wraps Expo Push.
  Sends push notification via the stored `User.pushToken`.
  Push delivery silently fails if the user deleted the app (token becomes invalid); email is the durable fallback.

- `lib/unsubscribe.ts` — HMAC token helpers.
  `signUnsubscribeToken(userId)` → URL-safe token signed with `UNSUBSCRIBE_SECRET`.
  `verifyUnsubscribeToken(userId, token)` → boolean (constant-time compare).
  Stateless: no DB row needed to issue or verify.

### Data model

- `LaunchWaitlist` — one row per opted-in user.
  Columns: `userId`, `email`, `lat` (coarse), `lng` (coarse), `notifiedAt?`.

- `User.emailOptOutAt` — nullable timestamp.
  Set by the POST /unsubscribe handler.
  Checked by `lib/marketingEmail.ts` before every send.

## Email compliance

Every marketing email sent by Fitsy must satisfy CAN-SPAM and RFC 8058.
`lib/marketingEmail.ts` enforces these mechanically:

- **Unsubscribe link** — `/unsubscribe?u=<userId>&t=<hmac>` in the email body.
  Stateless HMAC signed with `UNSUBSCRIBE_SECRET`.
- **List-Unsubscribe header** — `<https://fitsy.org/unsubscribe?u=...&t=...>` (mailto fallback optional).
- **List-Unsubscribe-Post: List-Unsubscribe=One-Click** (RFC 8058) — enables one-click unsubscribe in Gmail and Apple Mail.
- **Physical postal address** — injected from `FITSY_POSTAL_ADDRESS` env var into every email footer.
  Legally required by CAN-SPAM.
- **Fail-closed env gates** — the send function throws (rather than silently omitting compliance elements) if any of the following are absent:
  - `RESEND_API_KEY` — no email provider
  - `UNSUBSCRIBE_SECRET` — cannot sign unsubscribe tokens
  - `FITSY_POSTAL_ADDRESS` — legally required footer element
- **Honor opt-out** — checks `User.emailOptOutAt` before sending; opted-out users are skipped, not errored.
- **Transactional carve-out** — only marketing emails are gated by `emailOptOutAt`.
  Account and service messages (receipts, password reset, etc.) are unaffected.

## How automated is it

Capture is fully automatic on opt-in — no operator action needed.

Notify is one operator call per city launch:

```
POST /api/internal/waitlist/notify
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json

{ "lat": 34.05, "lng": -118.24, "radiusMiles": 30, "city": "Los Angeles", "dryRun": false }
```

Run with `dryRun: true` first to preview the count.
Then re-run with `dryRun: false` to send.

Future automation path: add a `LiveArea` table (city polygon or center + radius) and a scheduled cron that diffs newly-added rows against the waitlist.
The radius-matching logic in the notify route is already the reusable core.

## Setup before launch

1. **Resend account + verified sender domain**
   - Create a Resend account and verify your sending domain.
   - Set `RESEND_API_KEY` in the `fitsy-api` Vercel env.
   - Set `FITSY_FROM_EMAIL` to a verified sender address (e.g. `hello@fitsy.org`).

2. **`UNSUBSCRIBE_SECRET`**
   - Generate a random 32+ byte secret: `openssl rand -hex 32`
   - Set as `UNSUBSCRIBE_SECRET` in the `fitsy-api` Vercel env.
   - This signs all unsubscribe tokens; rotating it invalidates existing links.

3. **`FITSY_POSTAL_ADDRESS`**
   - Set to a real physical mailing address.
   - This is legally required by CAN-SPAM and appears in every marketing email footer.
   - Example: `123 Main St, Los Angeles, CA 90001, USA`

4. **Confirm Instagram handle**
   - Verify the `FITSY_INSTAGRAM` constant in `apps/mobile/app/welcome/out-of-area.tsx` points to the correct handle before launch.

## App Store / privacy

**No ASC submission or App Store review needed.**
This ships as an OTA JS update (Expo) plus backend route changes — no new native binary.

- **App Privacy nutrition label (ASC): no change.**
  Email (Contact Info) and Location are already declared in the nutrition label.
  The launch notification is an "App Functionality" use of data the user explicitly opted into.
  Push is covered by the already-granted notification permission.
  No new data type or purpose category is introduced.

- **Privacy policy webpage: updated.**
  The "Launch waitlist" section in `apps/api/app/privacy/page.tsx` now reflects both channels (push + email), the occasional marketing email use, unsubscribe mechanics, and the marketing-only scope of opt-out.
  Editing the privacy webpage is editing Fitsy's own site — it is not an Apple resubmission.

- **Data minimization.**
  Only account email and a coarse (~city-level) location are stored, and only for users who explicitly opt in.
  Precise location and location history are never stored.
