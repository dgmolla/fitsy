# Email automation

## Problem

Fitsy collects one launch email list from two surfaces (onboarding "Notify me at launch" and the fitsy.org waitlist form; see [launch-waitlist.md](launch-waitlist.md)).
Until now only app accounts received any recurring email, the launch blast was a manual operator call, and nothing was sent in response to what a person did or when they joined.
Every send path needs the same guarantees: one send per step per address, never two marketing emails too close together, and opt-out honoured by address.

## Solution

Two schedules feed one send ledger.

1. **Static (calendar) schedule.** The Tuesday weekly editorial (accounts now; confirmed waitlist-only addresses once double opt-in ships), plus the launch-day blast, which fires from a daily cron from the date in `apps/api/lib/launch.ts` onward.
2. **Dynamic (lifecycle) schedule.** A daily cron that walks a table of steps keyed on an anchor event and an offset (waitlist join +3d, +7d; account created +1d, +3d, +7d) and sends whatever is due. Ships in a follow-up PR, together with the double opt-in confirmation that becomes step zero of the waitlist track.

The `MarketingSend` ledger records every marketing send by normalized address, campaign, and step.
It gives every campaign idempotency and the cross-campaign frequency cap.

## Edge Cases

1. The same person is both an account and a waitlist row: the audience helper collapses them to one recipient (the account), so one address is one history.
2. A lifecycle step and the weekly edition fall due on the same day: the frequency cap (48 hours between marketing emails to one address) makes the weekly skip that address; the next week's edition is different, so nothing is lost.
3. A send fails at the provider: it is not recorded, so the next run retries it. A launch-day blast that partially fails is safe to re-run; `notifiedAt` makes it idempotent per row.
4. The launch-day cron runs every day: before the launch date it no-ops; on and after it, it runs the blast, which is idempotent per row, so later ticks resume a blast cut short by the time budget and pick up post-launch signups at near-zero cost. A stalled run or any failures are reported to Slack from the cron itself.
6. Provider rate limit: the send wrapper honours one 429 with its `Retry-After` (capped at 5 seconds) before reporting the send as failed; failed sends are retried by the next run.
5. Legacy weekly history: the migration copies the old `_marketing_send` rows (edition per user) into the ledger by address so nobody receives an edition twice. The old table is left in place (expand step); a later migration drops it once the ledger-backed cron has run in production.

## Out of Scope

- Push notifications other than the launch push.
- Transactional email (receipts, security), which never goes through the ledger or the opt-out gate.
- Per-user send-time optimisation; the crons run around 16:00 UTC (09:00 Pacific), staggered so no two send campaigns share a minute (weekly 16:00, launch-day 16:30).

---

## Diagrams

```mermaid
flowchart TD
    subgraph Static schedule
        W[Vercel cron Tue 16:00 UTC] --> WR[/api/internal/marketing/weekly]
        L[Vercel cron daily 16:30 UTC] --> LD[/api/internal/waitlist/launch-day]
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
- `lib/marketingAudience.ts`: accounts not opted out anywhere, optionally union waitlist-only rows not opted out anywhere (each branch mirrors the other table's opt-out for the address), one recipient per address, undeliverable seeds removed. The weekly cron passes `includeWaitlistOnly: false` until double opt-in gates those rows on `confirmedAt`.
- `lib/launchNotify.ts`: the launch blast, shared by the operator route and the launch-day cron. Records successful emails under campaign `launch` with the city as the step.
- Weekly cron: audience from the helper, edition dedup and pacing from the ledger, recipient kind (`userId` or `waitlistId`) decides which unsubscribe link is minted.

## Interface

| Route | Trigger | Body / query | Response |
|-------|---------|--------------|----------|
| `GET /api/internal/marketing/weekly` | cron, Tuesday 16:00 UTC | `?dryRun=1` | `{ ok, edition, eligible, sent, skipped, paced, failed }` |
| `GET /api/internal/waitlist/launch-day` | cron, daily 16:30 UTC | `?dryRun=1` | `{ ok, skipped, today, launchDate }` before launch; from launch day on, the blast result, drained in batches until none remain or a batch makes no progress (`stalled: true`) |
| `POST /api/internal/waitlist/notify` | operator | `{ lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }` | `{ ok, matched, viaPush, viaEmail, notified, suppressed, failed, remaining }`; dry run: `{ matched, wouldNotify, wouldSuppress }` |

All three require the `CRON_SECRET` bearer.

## Constraints

- Opt-out is address-keyed and enforced inside `sendMarketingEmail`; audience queries are a reporting pre-filter, not the gate.
- Every marketing email carries the CAN-SPAM footer and RFC 8058 one-click headers (see [marketing-emails.md](marketing-emails.md)).
- One send per (address, campaign, step), ever; the weekly step carries the week index so editions recur per rotation. The launch blast is additionally idempotent per row via `notifiedAt`.
- No marketing email to an address within 48 hours of another one, except the launch blast, which is the one email people explicitly asked for.
- Sends are sequential and bounded per invocation (500 for the crons, 400 per launch batch); the ledger, or `notifiedAt` for the launch blast, makes the next invocation pick up the remainder. Every send route sets `maxDuration = 300`.
- The address-keyed opt-out lookup is served by a functional index on `lower("User"."email")`.
