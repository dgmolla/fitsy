# Launch waitlist

One launch email list (`LaunchWaitlist`), fed by two surfaces:

1. **Onboarding** - out-of-area users who tap "Notify me at launch" (account email + coarse, city-level location).
2. **Website** - visitors who enter their email in the "Join the waitlist" form on fitsy.org (email only; no account, no location).

Rows are keyed by normalized email, so the same person joining from both surfaces is one row.
An onboarding join onto an existing website row links the account and adds the location.
Both push and email are sent at notify time; email is the durable channel.
Opt-in only - no data stored until the user taps "Notify me at launch" or submits the form.

## Flow

```mermaid
sequenceDiagram
    participant App as Mobile app
    participant API as fitsy-api
    participant DB as Postgres
    participant Expo as Expo Push
    participant Resend as Resend (email)

    participant Web as fitsy.org

    App->>API: location preview (onboarding)
    API-->>App: empty result - out of area
    App->>App: show out-of-area screen

    Note over App: user taps "Notify me at launch" (explicit opt-in)
    App->>API: POST /api/waitlist { lat, lng }  (authed)
    API->>DB: upsert LaunchWaitlist by email { userId, source: onboarding, coarse lat/lng }
    Note over API,DB: coords rounded to ~1 decimal place (city precision) before storage

    Note over Web: visitor submits "Join the waitlist" form
    Web->>API: POST /api/waitlist/web { email, website (honeypot) }  (public, rate-limited)
    API->>DB: upsert LaunchWaitlist by email { source: web } (no-op if already listed)

    Note over API: operator calls when a city goes live
    API->>API: POST /api/internal/waitlist/notify { lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }
    Note over API: CRON_SECRET auth
    API->>DB: fetch unnotified, not-opted-out entries within radius (+ unlocated web rows if includeUnlocated)
    API->>Expo: send push notification (User.pushToken, account-linked rows only)
    API->>Resend: send marketing email
    Note over Expo,Resend: both channels attempted; notifiedAt set if either succeeds
    API->>DB: set LaunchWaitlist.notifiedAt (idempotent re-runs skip already-notified)

    Note over App,Resend: unsubscribe path (email only)
    Resend-->>App: email contains /unsubscribe?u=<userId>&t=<hmac> (account) or ?w=<waitlistId>&t=<hmac> (web-only)
    App->>API: GET /unsubscribe?... (confirm page, no mutation)
    App->>API: POST /unsubscribe?... (user submits confirm form)
    API->>DB: u: set User.emailOptOutAt; w: set LaunchWaitlist.emailOptOutAt (+ linked User, if any)
    Note over API: future marketing emails to this recipient are silently skipped
```

## Pieces

### Routes

- `POST /api/waitlist` (authed) - stores account email and a coarse, city-level location.
  Upserts by normalized email so it never duplicates, and links the account onto a prior website signup.
  Coords are rounded to ~1 decimal place before storage.
  Never resets `notifiedAt` or `emailOptOutAt`.

- `POST /api/waitlist/web` (public) - the fitsy.org form.
  Body `{ email, website? }`; `website` is a honeypot that real users never see.
  Per-IP rate limit (5 per 10 minutes), email shape check, reserved-TLD rejection.
  Upserts by normalized email with an empty update, so an existing row is untouched.
  Always answers `{ ok: true }` for a well-formed address so membership cannot be probed.

- `POST /api/internal/waitlist/notify` (CRON_SECRET) - run once when a city launches.
  Accepts `{ lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }`.
  Website rows have no location and never radius-match; `includeUnlocated: true` folds them into the blast (use it for the first city launch).
  With `dryRun: true` it returns the count of users who would be notified without sending anything.
  Idempotent: entries with `notifiedAt` already set are skipped, as are opted-out rows.
  Sets `notifiedAt` when either push or email succeeds.

- `GET /unsubscribe` - renders a confirmation page with a button.
  Accepts `?u=<userId>` (account) or `?w=<waitlistId>` (web-only email) plus `&t=<token>`.
  Performs no mutation (safe for mail-scanner prefetch).
  Validates the HMAC token before rendering.

- `POST /unsubscribe` - processes the unsubscribe.
  Re-validates the HMAC token, then sets `User.emailOptOutAt` (`u`) or `LaunchWaitlist.emailOptOutAt` plus the linked user's, if any (`w`).
  Marketing email stops; transactional and account messages are unaffected.

### Libraries

- `lib/marketingEmail.ts` - wraps Resend.
  Takes a recipient of `{ userId }` or `{ waitlistId }`, which decides where opt-out is read and which unsubscribe link is minted.
  Injects List-Unsubscribe and List-Unsubscribe-Post headers (RFC 8058 one-click).
  Appends unsubscribe link and physical postal address to every message.
  Fails closed: returns false if `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET`, or `FITSY_POSTAL_ADDRESS` is missing.
  Skips send (returns false) if the recipient's `emailOptOutAt` is set.

- `lib/waitlist.ts` - email normalization and validation shared by both write paths, plus the coordinate rounding.

- `lib/launchPush.ts` — wraps Expo Push.
  Sends push notification via the stored `User.pushToken`.
  Push delivery silently fails if the user deleted the app (token becomes invalid); email is the durable fallback.

- `lib/unsubscribe.ts` - HMAC token helpers.
  `makeUnsubscribeToken(subject)` → hex token signed with `UNSUBSCRIBE_SECRET`, where subject is `{ userId }` or `{ waitlistId }`.
  Waitlist subjects are prefixed before hashing, so a token for one kind never validates the other.
  `verifyUnsubscribeToken(subject, token)` → boolean (constant-time compare).
  Stateless: no DB row needed to issue or verify.

### Data model

- `LaunchWaitlist` - one row per email address.
  Columns: `email` (unique, normalized), `userId?` (unique; null for web signups), `source` (`onboarding` | `web`), `lat?` / `lng?` (coarse; null for web signups), `city?`, `notifiedAt?`, `emailOptOutAt?`.

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

Capture is fully automatic on opt-in - no operator action needed.

Notify is one operator call per city launch:

```
POST /api/internal/waitlist/notify
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json

{ "lat": 34.05, "lng": -118.24, "radiusMiles": 30, "city": "Los Angeles", "includeUnlocated": true, "dryRun": false }
```

Run with `dryRun: true` first to preview the count.
Then re-run with `dryRun: false` to send.
Set `includeUnlocated: true` for the first launch so website signups (no location) hear about it; later city launches should leave it off, since those rows were already notified.

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
This ships as backend route changes plus the website form; the mobile client is unchanged.

- **App Privacy nutrition label (ASC): no change.**
  Email (Contact Info) and Location are already declared in the nutrition label.
  The launch notification is an "App Functionality" use of data the user explicitly opted into.
  Push is covered by the already-granted notification permission.
  No new data type or purpose category is introduced.

- **Privacy policy webpage: updated.**
  The "Launch waitlist" section in `apps/api/app/privacy/page.tsx` reflects both channels (push + email), the website form (email only), the occasional marketing email use, unsubscribe mechanics, and the marketing-only scope of opt-out.
  Editing the privacy webpage is editing Fitsy's own site — it is not an Apple resubmission.

- **Data minimization.**
  Onboarding stores only the account email and a coarse (~city-level) location, and only for users who explicitly opt in.
  The website stores only the email that was typed in.
  Precise location and location history are never stored.
