# Email automation

## Problem

Fitsy collects one launch email list from two surfaces (onboarding "Notify me at launch" and the fitsy.org waitlist form; see [launch-waitlist.md](launch-waitlist.md)).
Until now only app accounts received any recurring email, the launch blast was a manual operator call, and nothing was sent in response to what a person did or when they joined.
Every send path needs the same guarantees: one send per step per address, never two marketing emails too close together, and opt-out honoured by address.

## Solution

Two schedules feed one send ledger.

1. **Static (calendar) schedule.** The Tuesday weekly editorial, now sent to the whole marketing audience (accounts and waitlist-only addresses), plus the launch-day blast, which fires from a daily cron on the date in `apps/api/lib/launch.ts`.
2. **Dynamic (lifecycle) schedule.** A daily cron that walks a table of steps keyed on an anchor event and an offset (waitlist join +3d, +7d; account created +1d, +3d, +7d) and sends whatever is due. Ships in a follow-up PR, together with the double opt-in confirmation that becomes step zero of the waitlist track.

The `MarketingSend` ledger records every marketing send by normalized address, campaign, and step.
It gives every campaign idempotency and the cross-campaign frequency cap.

## Edge Cases

1. The same person is both an account and a waitlist row: the audience helper collapses them to one recipient (the account), so one address is one history.
2. A lifecycle step and the weekly edition fall due on the same day: the frequency cap (48 hours between marketing emails to one address) makes the weekly skip that address; the next week's edition is different, so nothing is lost.
3. A send fails at the provider: it is not recorded, so the next run retries it. A launch-day blast that partially fails is safe to re-run; `notifiedAt` makes it idempotent per row.
4. The cron fires on the wrong day: the launch-day route compares the UTC date with the launch constant and no-ops.
5. Legacy weekly history: the migration copies the old `_marketing_send` rows (edition per user) into the ledger by address so nobody receives an edition twice. The old table is left in place (expand step); a later migration drops it once the ledger-backed cron has run in production.

## Out of Scope

- Push notifications other than the launch push.
- Transactional email (receipts, security), which never goes through the ledger or the opt-out gate.
- Per-user send-time optimisation; all crons run at 16:00 UTC (09:00 Pacific).

---

## Diagrams

```mermaid
flowchart TD
    subgraph Static schedule
        W[Vercel cron Tue 16:00 UTC] --> WR[/api/internal/marketing/weekly]
        L[Vercel cron daily 16:00 UTC] --> LD[/api/internal/waitlist/launch-day]
        LD -->|"today == LAUNCH_DATE_ISO"| LN[lib/launchNotify.notifyLaunch]
        OP[Operator POST /api/internal/waitlist/notify] --> LN
    end
    subgraph Dynamic schedule - follow-up PR
        D[Vercel cron daily 16:00 UTC] --> LC[/api/internal/marketing/lifecycle]
        LC --> STEPS[steps: anchor + offset]
    end
    WR --> AUD[lib/marketingAudience]
    LC --> AUD
    AUD --> U[(User: not opted out)]
    AUD --> WL[(LaunchWaitlist: unlinked, not opted out)]
    WR --> LED[(MarketingSend ledger)]
    LC --> LED
    LN --> LED
    LED -->|"wasSent? sentWithin 48h?"| WR
    WR --> SEND[lib/marketingEmail.sendMarketingEmail]
    LC --> SEND
    LN --> SEND
    SEND -->|"isEmailOptedOut(address)"| SUP{opted out?}
    SUP -->|no| R[Resend]
    SUP -->|yes| X[skip]
```

---

## Approach

- `MarketingSend(email, campaign, step, sentAt)` with a unique key on the first three columns. Campaigns: `weekly`, `launch`, `lifecycle`.
- `lib/marketingLedger.ts`: `wasSent`, `recordSend` (idempotent upsert), `sentWithin` (frequency cap, default 48 hours).
- `lib/marketingAudience.ts`: accounts not opted out anywhere, union waitlist-only rows not opted out, one recipient per address, undeliverable seeds removed.
- `lib/launchNotify.ts`: the launch blast, shared by the operator route and the launch-day cron. Records successful emails under campaign `launch` with the city as the step.
- Weekly cron: audience from the helper, edition dedup and pacing from the ledger, recipient kind (`userId` or `waitlistId`) decides which unsubscribe link is minted.

## Interface

| Route | Trigger | Body / query | Response |
|-------|---------|--------------|----------|
| `GET /api/internal/marketing/weekly` | cron, Tuesday 16:00 UTC | `?dryRun=1` | `{ ok, edition, eligible, sent, skipped, paced, failed }` |
| `GET /api/internal/waitlist/launch-day` | cron, daily 16:00 UTC | `?dryRun=1` | `{ ok, skipped, today, launchDate }` off-day; launch result on the day, drained in batches |
| `POST /api/internal/waitlist/notify` | operator | `{ lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }` | `{ ok, matched, viaPush, viaEmail, notified, suppressed, failed, remaining }`; dry run: `{ matched, wouldNotify, wouldSuppress }` |

All three require the `CRON_SECRET` bearer.

## Constraints

- Opt-out is address-keyed and enforced inside `sendMarketingEmail`; audience queries are a reporting pre-filter, not the gate.
- Every marketing email carries the CAN-SPAM footer and RFC 8058 one-click headers (see [marketing-emails.md](marketing-emails.md)).
- One send per (address, campaign, step), ever. The launch blast is additionally idempotent per row via `notifiedAt`.
- No marketing email to an address within 48 hours of another one, except the launch blast, which is the one email people explicitly asked for.
- Sends are sequential and bounded per invocation (500 for the crons, 400 per launch batch); the ledger, or `notifiedAt` for the launch blast, makes the next invocation pick up the remainder. Every send route sets `maxDuration = 300`.
- The address-keyed opt-out lookup is served by a functional index on `lower("User"."email")`.
