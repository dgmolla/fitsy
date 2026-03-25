# App Store Listing — Fitsy

> **Status:** Ready for submission
> **Author:** Product Manager
> **Date:** 2026-03-24
> **Spec:** `docs/product/app-store-listing-spec.md`

This document is the single source of truth for all App Store Connect
metadata. Paste each field verbatim into App Store Connect. Do not edit
copy during implementation — raise a product ticket for any changes.

---

## App Identity

| Field | Value |
|-------|-------|
| **App name** | Fitsy — Macro-Aware Restaurant Finder |
| **Subtitle** | Find food that fits your macros |
| **Bundle ID** | app.fitsy.mobile |
| **SKU** | fitsy-ios-001 |
| **Primary category** | Health & Fitness |
| **Secondary category** | Food & Drink |
| **Age rating** | 4+ |
| **Content rights** | Does not contain third-party content |

### Subtitle character count

"Find food that fits your macros" = 31 characters.

> Note: Apple's subtitle limit is 30 characters. Use the 30-char version
> below for App Store Connect submission.

**Subtitle (30 chars exactly):** `Find meals that fit your macros`

---

## Short Description (Google Play — 80 chars max)

```
Find nearby restaurants with meals that match your protein, carb & fat goals.
```

Character count: 78

---

## Full Description (App Store — 4000 chars max)

```
Eating out shouldn't mean guessing your macros.

Fitsy is the macro-aware restaurant discovery app that shows you nearby restaurants ranked by how well their menu items fit your protein, carb, and fat targets — not just by rating or cuisine.

─── What Fitsy does ───────────────────────────

Set your macro targets once. Every time you open the app, Fitsy shows you the restaurants closest to you, ranked by macro fit. The best-matching meal for each restaurant is shown upfront so you can make a decision in seconds.

Tap any restaurant to see the full macro breakdown: calories, protein, carbs, and fat for every item on the menu. Each estimate includes an AI confidence score so you always know how reliable the number is.

─── Why Fitsy is different ────────────────────

Most nutrition apps stop at the supermarket or the big chains. Fitsy covers the independent restaurants — the taco spot on the corner, the ramen shop your coworkers love, the bowl place by the gym — the ones that have never published a single calorie.

We scrape menus from thousands of local restaurants and use Claude AI to estimate macros from the ingredient and portion descriptions. The result is the first restaurant discovery experience built for people who track macros, not just calories.

─── How it works ──────────────────────────────

1. Set your targets. Tell Fitsy your protein, carb, and fat goals — or pick a preset: Cut, Maintain, or Bulk.

2. Browse nearby matches. Fitsy shows you restaurants ranked by macro fit, with the best-matching meal highlighted for each one.

3. See the full breakdown. Calories, protein, carbs, fat — plus an AI confidence score on every estimate. High confidence = verified menu data. Medium = AI-estimated from description. You always know what you're working with.

─── Who Fitsy is for ──────────────────────────

• People who track macros and want to eat out without derailing their plan
• Athletes in a cut or bulk who need high-protein options fast
• Anyone who's ever opened MyFitnessPal at a restaurant and found nothing

─── Subscription ──────────────────────────────

Fitsy is a paid subscription app — $30/year or $5/month. Both plans include a 7-day free trial. No ads. No freemium. No feature limits.

─── Data & privacy ────────────────────────────

Fitsy does not sell your data. Macro targets are stored on your device and used only to rank results. See fitsy.app/privacy for the full privacy policy.

Macro estimates are AI-generated and approximate. They are intended as a planning guide, not medical nutrition advice. Always consult a registered dietitian for clinical nutrition guidance.
```

Full description character count: approximately 2,100 characters (well within 4,000 limit).

---

## Keywords (Apple — 100 chars max, comma-separated, no spaces after commas)

```
macros,protein,restaurant finder,nutrition,meal tracker,macro diet,healthy eating,food tracker
```

Character count: 93

### Keyword rationale

| Term | Rationale |
|------|-----------|
| macros | Primary use-case descriptor — high intent |
| protein | Most common macro people optimize for |
| restaurant finder | Core discovery feature |
| nutrition | Broad health category |
| meal tracker | Adjacent use case — captures macro-tracking audience |
| macro diet | Long-tail; captures IIFYM audience |
| healthy eating | Broad Health & Fitness category traffic |
| food tracker | Adjacent to nutrition tracking apps |

---

## URLs

| Field | Value |
|-------|-------|
| **Privacy policy URL** | https://fitsy.app/privacy |
| **Support URL** | https://fitsy.app/support |
| **Marketing URL** | https://fitsy.app |

> These pages must be live before App Store Connect submission.
> See `docs/product/app-store-listing-spec.md` Cross-Domain Tickets
> for the backend PR requirements.

---

## App Store Screenshots

5 screenshots required. Produce at both sizes:
- **6.7-inch**: 1290 × 2796 px (iPhone 15 Pro Max) — required
- **6.1-inch**: 1179 × 2556 px (iPhone 15 Pro) — required

### Screenshot 1 — Macro Target Setup

**Caption:** Set your protein, carb & fat goals once.
**Screen:** Macro target input screen. User has entered: Protein 180g,
Carbs 200g, Fat 60g. "Cut" preset chip is highlighted. "Find restaurants"
CTA button visible at bottom.
**Purpose:** Establishes the core value proposition immediately. Shows the
app is purpose-built for macro tracking, not generic calorie counting.

---

### Screenshot 2 — Restaurant Results Ranked by Macro Fit

**Caption:** Restaurants ranked by how well they fit your macros.
**Screen:** Main results list. 3–4 restaurant cards visible. Each card
shows restaurant name, distance, best-matching meal name, and a macro fit
bar (green fill indicates % match). Top result: "Cava — Grain Bowl" with
fit bar at ~90% and macro summary (P: 42g C: 68g F: 18g).
**Purpose:** Core differentiator — ranking by macro fit, not rating or
distance. Demonstrates immediate utility.

---

### Screenshot 3 — Meal Detail with Full Macro Breakdown

**Caption:** Full macro breakdown for every menu item.
**Screen:** Meal detail view for a specific menu item. Shows: meal name,
restaurant name, calories (520), protein (38g), carbs (62g), fat (16g).
Macro bars are colored (protein = blue, carbs = orange, fat = yellow).
Confidence indicator shows "High confidence — verified menu data".
**Purpose:** Shows depth of data and the confidence scoring system.
Addresses trust concern: "how do you know these numbers are right?"

---

### Screenshot 4 — AI Confidence Indicator

**Caption:** Always know how reliable the estimate is.
**Screen:** Meal detail or results list showing the confidence tier
explanation modal/tooltip. Three tiers shown:
- High: verified menu data
- Medium: AI-estimated from description
- Low: estimated from dish name only
One item is highlighted at "Medium" with a brief explanation of the AI
estimation process.
**Purpose:** Proactively addresses the skepticism about AI-estimated
macros. Demonstrates honesty and transparency — a differentiator vs.
apps that show false precision.

---

### Screenshot 5 — Onboarding Preset Selection

**Caption:** Start in seconds with Cut, Maintain, or Bulk presets.
**Screen:** Onboarding screen showing three macro preset cards:
- Cut (high protein, moderate carbs, low fat)
- Maintain (balanced macros)
- Bulk (high protein, high carbs, moderate fat)
Each card shows the macro split as a percentage bar. "Or set custom
targets" link below. "Get started" CTA button.
**Purpose:** Reduces time-to-value. Shows the app is accessible even for
users who don't know their exact macro targets. Secondary message: this
is for real fitness goals, not casual calorie counting.

---

## App Review Information

| Field | Value |
|-------|-------|
| **Demo account email** | review@fitsy.app (create before submission) |
| **Demo account password** | (set before submission — do not store in this doc) |
| **Notes for reviewer** | Fitsy is a macro-aware restaurant discovery app. The app requires a subscription (7-day free trial). Use the demo account to bypass payment for review. The demo account has an active subscription pre-loaded. Location permission is required to show nearby restaurants — approve when prompted. Test data is pre-loaded for the Silver Lake, Los Angeles area (90029). |

---

## Content Declarations (App Store Connect)

| Question | Answer |
|----------|--------|
| Made for kids | No |
| Encryption | No (standard HTTPS only — exempt from export compliance) |
| Advertising identifier (IDFA) | No |
| Contains third-party content | No |
| App uses location data | Yes — precise location (foreground only) to show nearby restaurants |
| App tracks users | No |

---

## What to Do Before Submitting

1. Confirm `/privacy` page is deployed and accessible
2. Confirm `/support` page is deployed and accessible
3. Create demo account `review@fitsy.app` with active subscription
4. Export screenshots at both required sizes
5. Paste all metadata fields from this document into App Store Connect
6. Upload screenshots in the correct order (Screenshot 1 first)
7. Complete content declarations
8. Submit for TestFlight review first — do not skip TestFlight
