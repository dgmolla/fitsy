# Landing Page

> **Status:** Draft — Sprint 5 S-32
> **Author:** Frontend
> **Date:** 2026-03-24

---

## Problem

Fitsy needs a public-facing web page that:
1. Explains what Fitsy is in 10 seconds
2. Drives downloads when the app is live on the App Store
3. Gives the project a credible URL for TestFlight beta invites

Currently the root URL (`fitsy-api.vercel.app`) returns a 404. Any link to Fitsy lands nowhere.

---

## Solution

A single-page Next.js marketing site at `/` in the API project. The existing Next.js backend already handles routing — adding a root `page.tsx` makes it serve a landing page without any additional infrastructure.

Three sections:
1. **Hero** — headline, sub-headline, email capture / App Store CTA
2. **Features** — three differentiating benefits (macro search, LLM estimation, restaurant discovery)
3. **Footer** — minimal: app name, tagline

---

## Diagrams

```mermaid
flowchart LR
    V[Visitor] --> LandingPage[/ Landing Page]
    LandingPage --> Hero["Hero: what Fitsy does + CTA"]
    LandingPage --> Features["Features: macro search, LLM estimation, discovery"]
    LandingPage --> Footer["Footer: copyright"]
    Hero --> CTA["App Store button (TestFlight until live)"]
```

---

## Approach

### Tech
- Next.js App Router, TypeScript, CSS Modules (no Tailwind — not in the project)
- No JS-only animations — pure CSS transitions for accessibility
- Mobile-responsive: single column on small screens, constrained max-width on desktop

### Colors (from design brief)
- Primary: `#2D9E6B` (teal-green)
- Accent/CTA: `#F97316` (amber-orange)
- Background: `#F9FAFB` (off-white)
- Text: `#111827` (near-black)

### Copy
- **Headline**: "Find food that fits your macros"
- **Sub-headline**: "Fitsy finds restaurants near you with meals that match your protein, carb, and fat targets — so you can eat out without blowing your plan."
- **CTA**: "Get Early Access" → TestFlight link (placeholder until live)

---

## Interface

### New files

```
apps/api/app/
├── layout.tsx          # Root HTML shell (required for Next.js App Router)
├── page.tsx            # Landing page component
└── landing.module.css  # CSS modules for landing page
```

### Route
`GET /` → renders landing page HTML

---

## Acceptance Criteria

- [ ] Root URL (`/`) returns 200 with the landing page HTML
- [ ] Page includes `<meta name="description">` and `<title>` for SEO
- [ ] "Get Early Access" CTA button is visible and links to a valid URL
- [ ] Page is readable on mobile (320px width) and desktop (1280px width)
- [ ] No inline styles (structural test enforced)
- [ ] `npm run build` succeeds with the landing page

## Edge Cases

1. **App Store not live yet** — CTA links to a `#waitlist` anchor or email form as placeholder until the real App Store URL is set
2. **API-only deployment** — The landing page shares the same Vercel deployment as the API, so no CDN/static host is needed. API routes under `/api/` are unaffected
3. **SEO / OG tags** — At MVP, provide title + description meta; full OG image is deferred

## Constraints

- No additional npm dependencies — CSS Modules are built into Next.js
- The page must not break existing API routes — root layout must not add middleware
- Copy and URLs are placeholders until App Store submission; easily updated

## Out of Scope

- App Store listing and screenshots
- OG image / social card
- Analytics pixel (deferred to Vercel Analytics setup in S-33 follow-up)
- Multi-page marketing site (about, pricing, blog)
