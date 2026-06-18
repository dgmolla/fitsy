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
- **Trial:** 3-day free trial on both plans — configured in App Store Connect,
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
    RC->>API: Webhook INITIAL_PURCHASE (app_user_id = Supabase UUID, expiresAt)
    API->>DB: Upsert Subscription { userId, status: active, expiresAt }
    App->>App: completeOnboarding() → navigate to /(tabs)/search

    Note over App,ASC: On renewal: Apple charges silently;<br/>RevenueCat fires RENEWAL webhook → API updates DB
    Note over App,API: Every protected request: requireSubscription()<br/>reads the Subscription row → 402 if not active
```

---

## Server-side entitlement verification

Fitsy does **not** use Stripe webhooks. Subscription state is kept current via:

1. **RevenueCat webhook** — RevenueCat sends `RENEWAL`, `CANCELLATION`,
   `EXPIRATION`, `BILLING_ISSUE`, and other events to a Fitsy API endpoint.
   The handler upserts the user's subscription record in PostgreSQL.

2. **`GET /api/subscriptions/status`** — server-trusted entitlement read the
   client uses to make the "must subscribe" decision server-side. (The old
   `POST /api/subscriptions/verify` receipt stub was removed 2026-06-16 —
   clients no longer send receipts.)

3. **API middleware** — `requireSubscription()` (`apps/api/lib/subscription.ts`)
   guards `/api/restaurants` and `/api/restaurants/[id]/menu`, reading the
   webhook-synced `Subscription` row. Returns `402 subscription_required` for
   unentitled users; the mobile `(tabs)` guard redirects to the paywall and a
   one-shot 402 retry covers the post-purchase webhook lag. Bypass:
   `ALLOW_STUB_SUBSCRIPTIONS` (dev) and `DEMO_REVIEW_EMAILS` (App Store reviewer).

### Database model (Prisma)

Subscription state lives in its own `Subscription` table (1:1 with `User`),
written **only** by the RevenueCat webhook:

```prisma
model Subscription {
  id                 String    @id @default(cuid())
  userId             String    @unique
  plan               String
  status             String    // "active" | "expired" | "billing_issue"
  appleTransactionId String?
  expiresAt          DateTime?
  createdAt          DateTime  @default(now())
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

---

## Upgrade / downgrade flows

| Flow | Behavior |
|------|----------|
| Monthly → Annual | Apple handles proration; RevenueCat reflects new plan; webhook updates DB |
| Annual → Monthly | Takes effect at next renewal; user stays `ACTIVE` until then |
| Cancel | Access until period end, then `EXPIRED` |
| Reactivate after cancel | New subscription; 3-day trial does NOT restart |
| Payment failure | Apple retries (Smart Retries); RevenueCat sets `GRACE_PERIOD`, then `PAST_DUE`; after ~16 days `EXPIRED` |
| Restore purchases | `restore()` via RC SDK; re-checks entitlements; completes onboarding if `pro` active |

---

## Production blockers (as of 2026-06-16)

RevenueCat is wired and ASC products are created. Remaining items:

| Blocker | Owner | Status |
|---------|-------|--------|
| Apple Developer account + ASC app record | `#human` | ✅ done (Apple ID 6763851364) |
| ASC subscription products (`fitsy_monthly`, `fitsy_annual`) | `#human` | ✅ created 2026-06-16 ($7.99 / $39.99, 3-day trial) |
| Bundle ID | `#frontend` | ✅ resolved — code + ASC agree on `com.fitsy.mobile` |
| `requireSubscription()` server gate | `#backend` | ✅ done — guards `/api/restaurants` + menu; `(tabs)` guard + 402-retry on client |
| RevenueCat webhook in production | `#backend` | Endpoint `POST /api/revenuecat/webhook` is live — **confirm URL + `REVENUECAT_WEBHOOK_AUTH` are set in the RC dashboard + Vercel** |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` in the production EAS build | `#frontend` | Verify it's set (test key only works in dev) |
| Discount offer price | `#product` | $14.99 modal vs 50%-off-$39.99 ($19.99) — reconcile + back with an ASC promotional offer |
| Paywall design sign-off | `#design` | `payment.tsx` functional; optional polish |

See `docs/product/pre-launch-action-items.md` for the full critical path.

---

## Pricing Decision Record

> **Status: CONFIRMED 2026-06-16 — $7.99/month · $39.99/year · 3-day free trial.**

The true source of truth for prices is the **RevenueCat offering**, which maps
to the **App Store Connect subscription products** (`fitsy_monthly` $7.99,
`fitsy_annual` $39.99, both with a 3-day introductory free trial), created
2026-06-16. The app reads prices live from the offering; `payment.tsx` fallback
strings mirror them for display only.

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

### Decision (confirmed 2026-06-16)

| Plan | Price | ASC product |
|------|-------|-------------|
| Monthly | **$7.99/mo** | `fitsy_monthly` |
| Annual | **$39.99/yr** | `fitsy_annual` |
| Free trial | **3 days** (both plans) | introductory offer in ASC |

### Alignment status

- [x] ASC subscription products created (`fitsy_monthly` $7.99, `fitsy_annual` $39.99, 3-day trial) — 2026-06-16
- [x] `payment.tsx` fallback strings updated to `$7.99/mo` · `$39.99/yr`
- [x] `app-store-listing.md` trial copy set to 3 days; price now references this record
- [x] Paywall title "Try Fitsy free for 3 days" matches the trial length
- [ ] **Discount offer — NEEDS A DECISION.** The exit-intent modal says "$14.99/year (50% off)". 50% off $39.99 is **$19.99**, so the copy/number is now inconsistent. Either (a) change the modal to $19.99 + keep "50% off", (b) keep $14.99 and reword (it's ~63% off), or (c) drop the promo. Whichever you pick must be backed by a real ASC **promotional offer** on `fitsy_annual`, or the purchase will fail.

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
