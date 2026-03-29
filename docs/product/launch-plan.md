# Launch Plan

**Status**: DRAFT
**Owner**: CTO
**Last updated**: 2026-03-29
**Geo**: Los Angeles — Hollywood + Silver Lake only

---

## Overview

This doc covers everything between "code works" and "real users paying." Two phases: (1) pre-launch checklist to unblock TestFlight, (2) 3 rounds of MVP testing at LA gyms, (3) go/no-go on public launch.

---

## Phase 1: Pre-Launch Checklist

Must be complete before Round 1 recruiting begins.

### Auth & Accounts

- [ ] **Publish Google OAuth** — currently test mode, needs Google verification for external users
- [ ] Apple Sign-In end-to-end (Developer entitlements, Supabase provider)
- [ ] Email/password auth working on Vercel production
- [ ] Account deletion flow (App Store requirement)

### App Store & TestFlight

- [ ] EAS production build (`eas build --platform ios --profile production`)
- [ ] TestFlight build uploaded and installable
- [ ] App Store Connect listing drafted (screenshots, description, keywords)
- [ ] Privacy policy + Terms of Service hosted (linked from welcome screen)

### Analytics

- [ ] **Integrate PostHog** (recommended) or alternative:
  - PostHog — open source, 1M events/mo free, RN SDK, session replay + feature flags
  - Mixpanel — 20M events/mo free, strong funnels
  - Amplitude — 50M events/mo free
- [ ] Track key events: `app_open`, `register`, `login`, `search`, `view_restaurant`, `save_item`, `set_macros`, `onboarding_complete`, `subscription_start`
- [ ] Onboarding funnel: welcome → age → ... → payment (drop-off per step)
- [ ] Retention: D1, D7, D30

### Data & Backend

- [ ] Preload pipeline run for Hollywood + Silver Lake (9 restaurants currently — expand?)
- [ ] API error monitoring (Sentry or PostHog errors)
- [ ] Rate limiting on auth endpoints
- [ ] Health check monitoring (uptime)

### Mobile Polish

- [ ] App icon finalized
- [ ] Splash screen (not default Expo)
- [ ] Deep linking tested (`fitsy://`)
- [ ] Dark mode polished
- [ ] Offline state handling

### Legal

- [ ] Privacy policy: location data, macro data, account data
- [ ] Health disclaimer: "Macro estimates are approximate — not medical advice"
- [ ] GDPR: data export + deletion on request
- [ ] Google OAuth verification (if using Google Sign-In)

### Performance

- [ ] App size < 50MB
- [ ] Cold start < 3s
- [ ] Search results < 2s
- [ ] No memory leaks on scroll

---

## Phase 2: MVP Testing (3 Rounds)

### Strategy

Validate with real users at LA gyms. Free access, no paywall. We're buying feedback with free access, not selling a product yet.

### Recruiting

**Where**: Gyms in Hollywood + Silver Lake (Gold's, Equinox, Barry's, local CrossFit, climbing gyms). Target post-workout crowd.

**Who**: People who track macros (phone out logging food, meal prep containers, shaker bottles). Ask: "Do you track your macros?"

**Pitch** (15 seconds):
> "I'm building an app that finds restaurants near you with meals matching your macros. It's free right now — I just need your feedback. Can I set you up?"

**Onboard** (2 minutes, on the spot):
1. Install via TestFlight QR code
2. Walk through first search so they see results immediately
3. Get name + phone/Instagram for follow-up
4. Tell them: "Use it for a week, then I'll ask 5 quick questions"

### Rounds

| Round | Duration | Goal | Exit Criteria |
|-------|----------|------|---------------|
| **1** | 1 week | Does the core loop work? Search → restaurant → eat. | 5/10 complete at least 1 search → visit. Major bugs fixed. |
| **2** | 1 week | Is macro data trustworthy? | Testers trust numbers for food decisions. No "obviously wrong" feedback. |
| **3** | 1 week | Would they pay? Habit forming? | 5/10 used 3+ times unprompted. 3/10 say they'd pay $4/mo. |

Each round = **new batch of 10** (fresh eyes). Fix top 3 issues between rounds.

### Feedback Collection

**Pipeline**: Google Form → Sheet → Claude insights

**Questions** (after 1 week):
1. How many times did you open Fitsy? (0, 1-2, 3-5, 6+)
2. Did you go to a restaurant you found on Fitsy? (Y/N)
3. If yes, which restaurant(s)?
4. How accurate did the macro estimates feel? (1-5)
5. Did you trust the numbers for a food decision? (Yes/Mostly/No)
6. Most frustrating part?
7. What did you like most?
8. Would you pay $4/month? (Definitely/Probably/Probably not/Definitely not)
9. Why or why not?
10. Anything else?

**LLM analysis** after each round — extract top 3 pain points, top 3 wins, trust signal, willingness to pay, exit criteria check, recommended fixes. Save to `docs/product/feedback/round-{N}-insights.md`.

### Timeline

| Week | Activity |
|------|----------|
| 1 | Round 1: recruit 10, onboard in person |
| 2 | Collect feedback, fix top issues |
| 3 | Round 2: recruit 10 new |
| 4 | Collect feedback, fix top issues |
| 5 | Round 3: recruit 10 new |
| 6 | Collect feedback, go/no-go on public launch |

**~6 weeks from first recruit to launch decision.**

---

## Phase 3: Public Launch

Only if Round 3 exit criteria met. Otherwise, keep iterating.

- [ ] Enable paywall (welcome flow payment screen)
- [ ] App Store submission + review
- [ ] Monitor crash reports (EAS Updates / Sentry)
- [ ] Monitor analytics funnels for drop-offs
- [ ] Respond to App Store reviews < 24h
- [ ] Expand preload geo if demand signals (search queries outside coverage area)

### What We're NOT Testing in MVP

- Payment flow (bypassed for testers)
- Onboarding conversion (hand-onboarded)
- Retention > 1 week per round
- Markets outside LA
