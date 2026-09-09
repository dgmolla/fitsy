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
    Web->>API: POST /api/waitlist/web { email, hp (honeypot) }  (public, rate-limited)
    API->>DB: upsert LaunchWaitlist by email { source: web } (no-op if already listed)

    Note over API: operator calls when a city goes live
    API->>API: POST /api/internal/waitlist/notify { lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }
    Note over API: CRON_SECRET auth
    API->>DB: fetch unnotified entries within radius (+ unlocated web rows if includeUnlocated)
    API->>Expo: send push notification (User.pushToken, account-linked rows only; NOT gated by email opt-out)
    API->>Resend: send marketing email (skipped when the address opted out)
    Note over Expo,Resend: both channels attempted; notifiedAt set if either succeeds, or if nothing may be sent (opted out, no push token)
    API->>DB: set LaunchWaitlist.notifiedAt (idempotent re-runs skip already-notified)

    Note over App,Resend: unsubscribe path (email only)
    Resend-->>App: email contains /unsubscribe?u=<userId>&t=<hmac> (account) or ?w=<waitlistId>&t=<hmac> (web-only)
    App->>API: GET /unsubscribe?... (confirm page, no mutation)
    App->>API: POST /unsubscribe?... (user submits confirm form)
    API->>DB: u: set User.emailOptOutAt + any LaunchWaitlist row for that account or address; w: set LaunchWaitlist.emailOptOutAt + linked User, if any
    Note over API: every sender checks opt-out BY ADDRESS across both tables (isEmailOptedOut), so the choice holds however the address is linked
```

## Pieces

### Routes

- `POST /api/waitlist` (authed) - stores account email and a coarse, city-level location.
  Upserts by normalized email so it never duplicates, and links the account onto a prior website signup.
  Coords are rounded to ~1 decimal place before storage.
  Opting in from a different coarse location (a website row gaining its first city, or a user who moved) is a fresh per-city opt-in, so `notifiedAt` is cleared; a re-tap from the same place keeps it (no re-spam).
  Linking onto a row that already opted out copies the opt-out onto the account.
  Never resets `emailOptOutAt`.

- `POST /api/waitlist/web` (public) - the fitsy.org form.
  Body `{ email, hp? }`; `hp` is a honeypot that real users never see (named so autofill never touches it).
  Per-IP rate limit (5 per 10 minutes), email shape check, reserved-TLD rejection.
  Upserts by normalized email with an empty update, so an existing row is untouched.
  Always answers `{ ok: true }` for a well-formed address so membership cannot be probed.

- `GET /api/internal/waitlist/launch-day` (CRON_SECRET, daily cron at 16:30 UTC) - the scheduled first-launch blast.
  No-op before `LAUNCH_DATE_ISO` in `apps/api/lib/launch.ts`; from that day on it runs the notify logic below with the launch center, the launch city, and `includeUnlocated: true`.
  Later daily runs are near-no-ops because `notifiedAt` is set, and they resume a blast cut short by the time budget and catch post-launch signups. See [email-automation.md](email-automation.md).

- `POST /api/internal/waitlist/notify` (CRON_SECRET) - run by hand when a later city launches.
  Accepts `{ lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }`.
  Website rows have no location and never radius-match; `includeUnlocated: true` folds them into the blast (use it for the first city launch).
  With `dryRun: true` it returns `matched`, `wouldNotify`, and `wouldSuppress` without sending anything.
  Live runs process up to 400 rows and report `remaining` (matched rows this call did not reach); re-run while it is above zero (already-notified rows are skipped). `failed` rows are deferred by the retry cooldown and picked up by a later tick, not by an immediate re-run.
  A failed row is retried at most once per 12 hours; after three failures it leaves the blast and is counted in `exhausted`. Reset its `notifyAttempts` to re-arm it.
  Idempotent: entries with `notifiedAt` already set are skipped.
  An email opt-out suppresses the email only; the push is a separately requested notification and still goes out.
  Sets `notifiedAt` when either push or email succeeds, and also when an opted-out entry's only allowed channel (push) is absent or failed (reported as `suppressed`) so the job converges.

- `GET /unsubscribe` - renders a confirmation page with a button.
  Accepts `?u=<userId>` (account) or `?w=<waitlistId>` (web-only email) plus `&t=<token>`.
  Performs no mutation (safe for mail-scanner prefetch).
  Validates the HMAC token before rendering.

- `POST /unsubscribe` - processes the unsubscribe.
  Re-validates the HMAC token, then sets `User.emailOptOutAt` plus any waitlist row for that account or address (`u`), or `LaunchWaitlist.emailOptOutAt` plus the linked user, if any (`w`).
  Marketing email stops; transactional and account messages are unaffected.

### Libraries

- `lib/marketingEmail.ts` - wraps Resend.
  Takes a recipient of `{ userId }` or `{ waitlistId }`, which decides which unsubscribe link is minted.
  Opt-out is checked by address, not by record: `isEmailOptedOut(email)` returns true if the `User` or the `LaunchWaitlist` row for that normalized address has `emailOptOutAt` set.
  An address can sit on both tables, linked or not, and can move between them, so this is the only check that cannot be bypassed by link state.
  The weekly marketing audience query applies the same rule with a `NOT EXISTS` on `LaunchWaitlist`.
  Injects List-Unsubscribe and List-Unsubscribe-Post headers (RFC 8058 one-click).
  Appends unsubscribe link and physical postal address to every message.
  Fails closed: returns false if `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET`, or `FITSY_POSTAL_ADDRESS` is missing.
  Skips send (returns false) if the address has opted out anywhere.

- `lib/waitlist.ts` - email normalization and validation shared by both write paths, plus the coordinate rounding.

- `lib/launchNotify.ts` - the matching and channel logic behind both the operator route and the launch-day cron.
  Successful emails are recorded in the `MarketingSend` ledger (campaign `launch`).

- `lib/launchPush.ts` - wraps Expo Push.
  Sends push notification via the stored `User.pushToken`.
  Push delivery silently fails if the user deleted the app (token becomes invalid); email is the durable fallback.

- `lib/unsubscribe.ts` - HMAC token helpers.
  `makeUnsubscribeToken(subject)` → hex token signed with `UNSUBSCRIBE_SECRET`, where subject is `{ userId }` or `{ waitlistId }`.
  Waitlist subjects are prefixed before hashing, so a token for one kind never validates the other.
  `verifyUnsubscribeToken(subject, token)` → boolean (constant-time compare).
  Stateless: no DB row needed to issue or verify.

### Data model

- `LaunchWaitlist` - one row per email address.
  `userId` is `SET NULL` on account deletion, not cascaded: the row may be a website signup in its own right and is the address-keyed opt-out record.
  `DELETE /api/user` removes an onboarding-sourced row that never opted out, strips the coarse location from any row that survives, and purges the address from the `MarketingSend` ledger unless a waitlist row for it remains.
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

The first launch (Los Angeles, date in `apps/api/lib/launch.ts`) is automatic: the daily launch-day cron fires the blast on that date, website signups included.

Later city launches are one operator call each:

```
POST /api/internal/waitlist/notify
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json

{ "lat": 34.05, "lng": -118.24, "radiusMiles": 30, "city": "Los Angeles", "includeUnlocated": true, "dryRun": false }
```

Run with `dryRun: true` first to preview the count.
Then re-run with `dryRun: false` to send.
`includeUnlocated: true` is what the launch-day cron uses for the first launch so website signups (no location) hear about it; later city launches should leave it off, since those rows were already notified.

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
