# Business Model & Pricing

> **Status:** Living document · **Last verified:** 2026-06-12

---

## Overview

Fitsy is a **paid-only subscription app** — no freemium tier. Subscriptions are
handled entirely through **Apple In-App Purchase (IAP)** managed by the
**RevenueCat SDK** (`react-native-purchases`). Stripe is not used and has been
deprecated.

---

## Subscription model

- **Entitlement:** `pro` (single entitlement; all features require it)
- **Plans:** Annual and Monthly (see Pricing Decision Record below for exact prices)
- **Trial:** 7-day free trial on both plans — configured in App Store Connect,
  surfaced by RevenueCat; no charge until trial ends
- **SDK:** `react-native-purchases` (RevenueCat React Native SDK)
- **Paywall:** `apps/mobile/app/welcome/payment.tsx` — Fitsy's own designed
  paywall; reads live prices from the current RevenueCat offering at runtime;
  falls back to hardcoded strings while offerings load

### Why no freemium

Freemium defers revenue and permanently segments the user base into a large
free cohort that does not convert. At MVP scale, every user who signs up should
be a paying user. One entitlement check, no feature flags per tier.

---

## Subscription / entitlement flow

```mermaid
sequenceDiagram
    participant U as User
    participant App as Mobile (RN)
    participant RC as RevenueCat SDK
    participant ASC as Apple App Store
    participant API as Fitsy API
    participant DB as PostgreSQL

    U->>App: Opens app / hits paywall
    App->>RC: getOfferings()
    RC-->>App: Current offering (annual + monthly packages, live prices)
    U->>App: Selects plan, taps "Start Free Trial"
    App->>RC: purchasePackage(pkg)
    RC->>ASC: IAP purchase sheet
    ASC-->>RC: Purchase receipt
    RC-->>App: CustomerInfo { entitlements: { pro: active } }
    App->>API: POST /api/subscriptions/verify (RevenueCat userId / receipt)
    API->>RC: GET /v1/subscribers/:userId (RevenueCat REST API)
    RC-->>API: Subscriber object (entitlements, expiresAt)
    API->>DB: Upsert user subscription state (expiresAt, status)
    API-->>App: 200 { subscribed: true, expiresAt }
    App->>App: completeOnboarding() → navigate to /(tabs)/search

    Note over App,ASC: On renewal: Apple charges silently;<br/>RevenueCat fires webhook → API updates DB
    Note over App,API: Every protected API request: middleware checks<br/>subscriptionStatus / expiresAt in DB
```

---

## Server-side entitlement verification

Fitsy does **not** use Stripe webhooks. Subscription state is kept current via:

1. **RevenueCat webhook** — RevenueCat sends `RENEWAL`, `CANCELLATION`,
   `EXPIRATION`, `BILLING_ISSUE`, and other events to a Fitsy API endpoint.
   The handler upserts the user's subscription record in PostgreSQL.

2. **RevenueCat REST API** (on-demand) — `GET /v1/subscribers/:app_user_id`
   used in `POST /api/subscriptions/verify` on each login / app launch to
   pull current entitlement state.

3. **API middleware** — `requireSubscription()` guard on protected routes
   checks `expiresAt` in DB. Returns `402` for expired or unentitled users.
   Mobile shows the paywall on `402`.

### Database fields (Prisma User model additions)

```prisma
revenuecatUserId      String?   @unique
subscriptionStatus    SubStatus @default(TRIALING)
subscriptionExpiresAt DateTime?
```

```prisma
enum SubStatus {
  TRIALING
  ACTIVE
  GRACE_PERIOD
  PAST_DUE
  CANCELED
  EXPIRED
}
```

---

## Upgrade / downgrade flows

| Flow | Behavior |
|------|----------|
| Monthly → Annual | Apple handles proration; RevenueCat reflects new plan; webhook updates DB |
| Annual → Monthly | Takes effect at next renewal; user stays `ACTIVE` until then |
| Cancel | Access until period end, then `EXPIRED` |
| Reactivate after cancel | New subscription; 7-day trial does NOT restart |
| Payment failure | Apple retries (Smart Retries); RevenueCat sets `GRACE_PERIOD`, then `PAST_DUE`; after ~16 days `EXPIRED` |
| Restore purchases | `restore()` via RC SDK; re-checks entitlements; completes onboarding if `pro` active |

---

## Production blockers (as of 2026-06-12)

The RevenueCat integration is wired on the **Test Store**. The following items
block production:

| Blocker | Owner | Notes |
|---------|-------|-------|
| Apple Developer Program account + signing | `#human` | Prerequisite for all IAP |
| Create subscription products in App Store Connect (`fitsy_annual`, `fitsy_monthly`) | `#human` | Prices must match final decision (see below) |
| Bundle ID mismatch | `#frontend` | `app.fitsy.mobile` must match ASC |
| Paywall design finalization | `#design` | Current `payment.tsx` is functional but needs design sign-off |
| RevenueCat webhook endpoint deployed to production | `#backend` | `POST /api/subscriptions/webhook` must be live and configured in RC dashboard |
| `POST /api/subscriptions/verify` stub → real validation | `#backend` | Currently returns 503 in prod behind `ALLOW_STUB_SUBSCRIPTIONS` |
| Server-side `requireSubscription()` guard on `/api/restaurants` | `#backend` | Currently not enforced; paywall can be bypassed |

See `docs/product/pre-launch-action-items.md` for the full critical path.

---

## Pricing Decision Record

> **Status: PENDING FOUNDER CONFIRMATION**

The true source of truth for prices is the **RevenueCat offering**, which maps
to the **App Store Connect subscription products**. Neither is configured yet
for production. Prices must be set once, deliberately, and aligned everywhere
before submission.

### All observed price points and their sources

| Price | Source | Notes |
|-------|--------|-------|
| $30/yr · $5/mo | `docs/product/app-store-listing.md` (listing copy) | Round numbers; never wired to ASC |
| $4.99/mo | `docs/product/archive/launch-plan.md` (RevenueCat section, product IDs) | Listed as the planned monthly price in the launch plan |
| $29.99/yr · $8.99/mo | `apps/mobile/app/welcome/payment.tsx` fallback strings | Designer/dev fallback copy while offerings load; closest to a "designed" price |
| $14.99/yr promo | `apps/mobile/app/welcome/payment.tsx` discount modal | "50% off" exit-intent offer; implies base annual = $29.99/yr |

### Why there is a conflict

These numbers were written in different documents at different times by
different roles without a shared canonical decision. No ASC product has ever
been created. The RevenueCat offering has not been configured. Until products
exist in ASC, no number is "real."

### Recommendation (PENDING FOUNDER CONFIRMATION)

Align to the **live paywall fallback values**: **$29.99/year + $8.99/month**.

Rationale:
- These are the numbers a user would see today if offerings fail to load — they
  already represent the designed UX copy and set an implicit expectation.
- $29.99/yr ≈ $2.50/mo effective rate — competitive with MFP ($10–$20/yr) and
  Cal.ai; low enough to remove cost as an objection.
- $8.99/mo is higher than the old $5/mo (increases LTV for monthly subscribers);
  still below Noom/MacroFactor; reasonable for a specialized tool.
- The $14.99/yr promo in the exit-intent modal is ~50% off $29.99/yr — clean
  marketing math that works.

**This is a recommendation only. The founder must confirm before ASC products
are created.**

### What must be aligned once pricing is confirmed

- [ ] Create ASC subscription products (`fitsy_annual` at confirmed price,
  `fitsy_monthly` at confirmed price, both with 7-day trial)
- [ ] Update `docs/product/app-store-listing.md` §Subscription copy (currently
  says "$30/year or $5/month" — see edit note in that file)
- [ ] Verify `payment.tsx` fallback strings match ASC prices exactly
- [ ] Confirm the `$14.99/yr` promo modal price in `payment.tsx` is valid (must
  correspond to a real discounted ASC product or promotional offer code)
- [ ] Update the paywall title (currently says "Try Fitsy free for 3 days" but
  the intended trial is 7 days — verify against ASC product config)

---

## Merchant revenue (future)

Advertising / promoted placement by verified merchants is the planned second
revenue line — the first that does not go through Apple's 30% commission.

See `docs/product/specs/merchant-dashboard.md` for the full spec: claim flow,
verified nutrition data model, and promoted-placement mechanics.

---

## Legacy: Stripe (superseded)

Stripe was the original payment design (S-34, spec dated 2026-03-24). It was
never implemented. Apple requires digital subscriptions distributed through the
App Store to use Apple IAP — a Stripe web-checkout flow would trigger App Store
rejection. The decision to switch to RevenueCat + IAP was made during launch
planning (see `docs/product/archive/launch-plan.md` §Payments).

Key artifacts from the Stripe design (for historical reference only):
- Products: `fitsy_annual` ($30/yr) and `fitsy_monthly` ($5/mo)
- Webhook events: `customer.subscription.created/updated/deleted`,
  `invoice.payment_failed`
- Database fields: `stripeCustomerId`, `subscriptionId`, `subscriptionStatus`
  (enum: TRIALING/ACTIVE/PAST_DUE/CANCELED/EXPIRED)
- Routes: `POST /api/billing/create-checkout-session`, `POST /api/billing/portal`,
  `POST /api/billing/webhook`

None of these were merged to main. No Stripe keys exist in the codebase.

---

## Out of scope (current)

- Web billing via Stripe (possible for web subscription to avoid Apple 30%, but
  deferred until post-launch)
- Team / family plans
- Lifetime license
- Usage-based pricing
- Referral / affiliate programs
- Google Play / Android (iOS only at launch)
