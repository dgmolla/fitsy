# Business Model & Pricing

> **Status:** Living document · **Pricing and trial configuration last verified:** 2026-09-22; other operational sections retain their stated dates

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
- **Trial:** A fourteen-day introductory free trial is the desired catalog policy for the existing monthly and annual offer territories.
  App Store Connect lists two-week free-trial offers in the same 175 territories for both regular plans as of 2026-10-01 UTC.
  The selected live StoreKit product and RevenueCat eligibility determine the actual offer; the discounted annual product has no introductory trial.
- **SDK:** `react-native-purchases` (RevenueCat React Native SDK)
- **Paywall:** `apps/mobile/app/welcome/payment.tsx` reads localized prices, billing periods, introductory duration, and eligibility from live store data through RevenueCat.
  Missing product terms remain unavailable; unknown eligibility never promises a free trial.
  Display copy does not substitute fixed prices or a fixed trial length.
  Optional trial reminders target 48 hours before the verified entitlement expiry, with quiet-hour delivery moved earlier when needed.
  The app schedules a reminder only after opt-in, notification permission, and a schedulable store-confirmed trial.

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
    U->>App: Selects plan, confirms live eligible trial or paid terms
    App->>RC: purchasePackage(pkg)
    RC->>ASC: IAP purchase sheet
    ASC-->>RC: Purchase receipt
    RC-->>App: CustomerInfo { entitlements: { pro: active } }
    RC->>API: Webhook INITIAL_PURCHASE (app_user_id = Supabase UUID, expiresAt)
    API->>DB: Upsert Subscription { userId, status: active, expiresAt }
    App->>App: completeOnboarding() → navigate to /(tabs)/search

    Note over App,ASC: On renewal: Apple charges silently;<br/>RevenueCat fires RENEWAL webhook → API updates DB
    Note over App,API: App gates on GET /api/subscriptions/status;<br/>every restaurant request: optionalSubscription()<br/>reads the Subscription row → locked/truncated if not active
```

---

## Server-side entitlement verification

Fitsy does **not** use Stripe webhooks. Subscription state is kept current via:

1. **RevenueCat webhook** — RevenueCat sends `RENEWAL`, `CANCELLATION`,
   `EXPIRATION`, `BILLING_ISSUE`, and other events to a Fitsy API endpoint.
   The handler upserts the user's subscription record in PostgreSQL.

2. **`GET /api/subscriptions/status`** - the server's entitlement verdict (`{ active, status, expiresAt }`).
   The mobile app gates on `active` at every launch; the on-device RevenueCat state is only a hint that triggers `POST /api/subscriptions/sync` (re-reads RevenueCat and upserts the row).
   (The old `POST /api/subscriptions/verify` receipt stub was removed 2026-06-16 - clients no longer send receipts.)

3. **API gate** - `optionalSubscription()` (`apps/api/lib/subscription.ts`) guards `/api/restaurants` and `/api/restaurants/[id]/menu`, reading the webhook/sync-maintained `Subscription` row.
   It never rejects: an unentitled caller gets a locked/truncated response (`locked: true`), which powers the onboarding teaser and the lapsed-subscriber browse-then-paywall flow.
   The former `requireSubscription()` 402 path was deleted 2026-09.
   Bypass: `ALLOW_STUB_SUBSCRIPTIONS` (dev) and `DEMO_REVIEW_EMAILS` (App Store reviewer).

### Database model (Prisma)

Subscription state lives in its own `Subscription` table (1:1 with `User`),
written **only** by the RevenueCat webhook and the RevenueCat REST sync:

```prisma
model Subscription {
  id                 String    @id @default(cuid())
  userId             String    @unique
  plan               String
  status             String    // "active" | "expired" | "billing_issue"
  appleTransactionId String?
  expiresAt          DateTime?
  lastEventAt        DateTime? // newest event/sync applied; older webhooks are ignored
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
| Reactivate after cancel | Store eligibility controls any introductory offer; restarting a subscription does not promise another trial |
| Payment failure | Apple retries (Smart Retries); RevenueCat sets `GRACE_PERIOD`, then `PAST_DUE`; after ~16 days `EXPIRED` |
| Restore purchases | `restore()` via RC SDK; re-checks entitlements; completes onboarding if `pro` active |

---

## Historical production checklist (2026-06-16)

This checklist records the June launch setup and is not the current release-status source.
The current pricing and trial configuration below supersedes its original offer terms.

| Blocker | Owner | Status |
|---------|-------|--------|
| Apple Developer account + ASC app record | `#human` | ✅ done (Apple ID 6763851364) |
| ASC subscription products (`fitsy_monthly`, `fitsy_annual`) | `#human` | ✅ created 2026-06-16; current product IDs and offers below |
| Bundle ID | `#frontend` | ✅ resolved — code + ASC agree on `com.fitsy.mobile` |
| `optionalSubscription()` server gate | `#backend` | ✅ done - guards `/api/restaurants` + menu (locked responses); client gates on `GET /api/subscriptions/status` |
| RevenueCat webhook in production | `#backend` | Endpoint `POST /api/revenuecat/webhook` is live — **confirm URL + `REVENUECAT_WEBHOOK_AUTH` are set in the RC dashboard + Vercel** |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` in the production EAS build | `#frontend` | Verify it's set (test key only works in dev) |
| Exit-intent discount product | `#human` | Product now exists as `com.fitsy.mobile.yearly_discount`; no introductory trial (verified 2026-09-22) |
| Paywall design sign-off | `#design` | `payment.tsx` functional; optional polish |

See `docs/product/pre-launch-action-items.md` for the full critical path.

---

## Pricing Decision Record

> **App Store Connect configuration verified 2026-10-01 UTC:** The monthly and annual products each list 175 two-week free-trial territories, with the original territory sets retained.
> The discounted annual product still has no introductory offer.
> Real eligible Apple purchase and entitlement-expiration acceptance remain separate from this catalog check.

App Store Connect configures subscription products, prices, and introductory offers.
The mobile paywall uses the selected live StoreKit product through RevenueCat and the customer's current introductory-offer eligibility.
This document records configuration, not a guarantee that every customer receives an offer or that every territory has product availability.

| Plan | US retail price | App Store product | Introductory configuration |
|------|-----------------|-------------------|---------------------------|
| Monthly | $7.99/month | `com.fitsy.mobile.monthly` | Two weeks configured for eligible subscribers |
| Annual | $39.99/year | `com.fitsy.mobile.yearly` | Two weeks configured for eligible subscribers |
| Discounted annual | $29.99/year | `com.fitsy.mobile.yearly_discount` | No introductory offer; billed on confirmation |

A read-only App Store Connect check after the change found 175 `TWO_WEEKS`, `FREE_TRIAL`, one-period offers for each regular product and no introductory offers for the discounted annual product.
The two regular products retain their original 175 offer territory codes, US prices, and monthly or annual renewal periods.
The prior 2026-09-30 baseline was 175 `ONE_WEEK` offers per regular product.
The seven-day rollout preserved existing offer territories and product availability; it did not expand availability to every offer territory.
Store configuration verification does not establish a particular customer's eligibility or prove an Apple sandbox purchase.

### Display authority and unavailable terms

`apps/mobile/lib/purchaseTerms.ts` derives localized charges, renewal periods, and eligible introductory duration from the selected product.
Missing price or billing-period data produces no purchase terms; unknown eligibility does not assert a free trial.
Cancellation and renewal disclosures follow those live terms.
Discount percentages are calculated only between comparable live products.
The June three-day copy and fixed-price mobile fallbacks are superseded.

The website reads US prices and introductory duration from App Store Connect in `apps/api/lib/pricing.ts`, caching successful reads for 24 hours.
If App Store Connect is unavailable, the website shows its existing fallback prices without claiming a free trial.
Live App Store Connect reads report a mismatch with the desired duration while continuing to display the real effective offer terms.
The generic website trial claim appears only when both regular plans have the same live introductory duration.

### Historical decisions

The original products were created on 2026-06-16 with a three-day introductory offer.
The discounted annual product was chosen on 2026-06-18.
The September seven-day configuration and live mobile disclosures supersede earlier launch-plan prices, fixed paywall strings, and three-day trial claims.

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
