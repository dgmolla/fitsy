# Business Model & Pricing

> **Status:** Approved — Sprint 5 implementation
> **Author:** Product Manager
> **Date:** 2026-03-24

---

## Problem

Fitsy needs a monetization model that:
1. Converts free users to paying subscribers at a viable rate
2. Keeps pricing low enough to compete with MFP/Cronometer ($10–$20/yr or free)
3. Does not require a freemium tier that permanently dilutes revenue
4. Can be implemented with minimal backend complexity for MVP

---

## Solution

**Paid subscription only — no freemium.**

Two plans:
- **Annual**: $30/year (~$2.50/month) — default, surfaced prominently
- **Monthly**: $5/month — fallback for users not ready to commit annually

This mirrors Cal.ai's model: a single low price that removes the cost-as-objection, no free tier to cannibalise conversions.

### Why no freemium

Freemium defers revenue and permanently segments the user base into a large free cohort that does not convert. At MVP scale, every user who signs up should be a paying user. This also keeps auth/gating logic simple — one entitlement check, no feature flags per tier.

### Trial strategy

7-day free trial on both plans (Stripe supports this natively). The trial starts on payment method capture, not on account creation. This filters out non-serious signups.

---

## Diagrams

```mermaid
graph TD
    A[User downloads app] --> B[Create account]
    B --> C[Select plan: $30/yr or $5/mo]
    C --> D[Stripe Checkout — 7-day trial]
    D --> E{Trial period}
    E -->|Day 1–7| F[Full app access]
    E -->|Day 7: trial ends| G[Stripe charges card]
    G --> H[Active subscriber — full access]
    G -->|Payment fails| I[Grace period 3 days]
    I -->|Still fails| J[Account downgraded — search blocked]
    J --> K[User updates payment → reactivates]

    L[Subscriber] --> M{Cancel?}
    M -->|Cancels| N[Access until period end]
    N --> O[Account expires → search blocked]
    M -->|Upgrades monthly → annual| P[Stripe prorates + switches]
```

---

## Approach

### Payment integration: Stripe

- **Products**: Two Stripe Products — `fitsy_annual` and `fitsy_monthly`
- **Prices**: $30/yr (one-time interval = year) and $5/mo
- **Trial**: 7-day `trial_period_days` on both
- **Checkout**: Stripe Payment Links for MVP — no custom checkout UI
- **Webhooks**: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

### Database changes needed (S-34)

Add to `User` model in Prisma:
```
stripeCustomerId  String?  @unique
subscriptionId    String?
subscriptionStatus  SubscriptionStatus  @default(TRIALING)
subscriptionPeriodEnd DateTime?
```

`SubscriptionStatus` enum: `TRIALING | ACTIVE | PAST_DUE | CANCELED | EXPIRED`

### Auth gating

API middleware reads `subscriptionStatus`. Allowed for `TRIALING` and `ACTIVE`. Returns `402` for all others with `{ "error": "Subscription required" }`.

Mobile client shows paywall screen on `402`.

### Upgrade / downgrade flows

| Flow | Behavior |
|------|----------|
| Monthly → Annual | Stripe prorates remaining monthly days as credit, switches to annual |
| Annual → Monthly | Switch takes effect at next renewal (no mid-period downgrade) |
| Cancel | Access until period end, then `EXPIRED` |
| Reactivate after cancel | New subscription — 7-day trial does NOT restart |
| Payment failure | 3-day grace period (Stripe Smart Retries), then `PAST_DUE` → `EXPIRED` after 7 days |

---

## Interface

### New API routes (S-34)

```
POST /api/billing/create-checkout-session
  → creates Stripe Checkout session, returns { url }

POST /api/billing/portal
  → creates Stripe Customer Portal session, returns { url }

POST /api/billing/webhook
  → receives Stripe webhook events, updates DB
```

### Mobile screens (S-35)

- **Paywall screen** — shown on app launch if no active subscription; shown on 402 response
- **Manage subscription** — links to Stripe Customer Portal (web)
- **Settings > Subscription** — shows current plan, next renewal date, cancel option

---

## Constraints

- MVP uses Stripe Payment Links, not a custom checkout UI — reduces implementation scope
- No annual-to-monthly mid-period downgrade at MVP — too many edge cases
- Stripe Customer Portal handles all subscription management — no custom UI for cancel/upgrade
- App Store in-app purchases are explicitly out of scope for MVP — Stripe web flow only

## Out of Scope

- In-app purchases (IAP) via App Store / Play Store
- Team/family plans
- Lifetime license
- Usage-based pricing
- Referral / affiliate programs
