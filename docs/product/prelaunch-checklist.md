# Pre-Launch Checklist

**Owner**: CTO
**Last updated**: 2026-03-29
**Target**: App Store + TestFlight launch

---

## Auth & Accounts

- [ ] **Publish Google OAuth to production** — currently in test mode, needs Google verification for external users (OAuth consent screen → publish)
- [ ] Apple Sign-In working end-to-end (registered with Apple Developer, entitlements configured)
- [ ] Email/password registration + login working on Vercel production
- [ ] Password reset flow (not yet built)
- [ ] Account deletion flow (App Store requirement)

## App Store

- [ ] EAS Build for production (`eas build --platform ios --profile production`)
- [ ] App Store Connect listing — screenshots, description, keywords, privacy policy URL
- [ ] Privacy policy + Terms of Service pages hosted (linked in welcome screen)
- [ ] App Review submission — ensure no placeholder content, mock data, or test accounts
- [ ] TestFlight build uploaded and tested by 10+ beta users (S-58 runbook)

## Analytics

- [ ] **Integrate analytics SDK** — evaluate and pick one:
  - [PostHog](https://posthog.com) — open source, self-hostable, free tier (1M events/mo), product analytics + session replay + feature flags. React Native SDK available.
  - [Mixpanel](https://mixpanel.com) — event-based analytics, strong funnels/retention, free tier (20M events/mo). Good RN SDK.
  - [Amplitude](https://amplitude.com) — similar to Mixpanel, free tier (50M events/mo). Solid RN support.
  - [Plausible](https://plausible.io) — privacy-focused, lightweight, but web-oriented (less ideal for mobile).
  - **Recommendation**: PostHog — best balance of features, privacy, and price for a startup. Self-host later if needed.
- [ ] Track key events: `app_open`, `register`, `login`, `search`, `view_restaurant`, `save_item`, `set_macros`, `onboarding_complete`, `subscription_start`
- [ ] Funnel: onboarding completion rate (welcome → age → ... → payment)
- [ ] Retention: D1, D7, D30

## Data & Backend

- [ ] Preload pipeline run for launch geo (Hollywood + Silver Lake confirmed, expand?)
- [ ] DB seeded with enough restaurants for good UX (currently 9 — need more?)
- [ ] API error monitoring (Sentry or similar)
- [ ] Rate limiting on auth endpoints

## Mobile

- [ ] App icon finalized and configured in `app.config.ts`
- [ ] Splash screen configured (not default Expo)
- [ ] Deep linking tested (`fitsy://` scheme)
- [ ] Push notifications setup (Expo Notifications)
- [ ] Offline state handling (show cached results or friendly error)
- [ ] Dark mode tested and polished

## Legal & Compliance

- [ ] Privacy policy covers: location data, macro data, account data
- [ ] GDPR: data export + deletion on request
- [ ] Health disclaimer: "Macro estimates are approximate — not medical advice"
- [ ] Google OAuth verification (if using Google Sign-In)

## Performance

- [ ] App size under 50MB
- [ ] Cold start under 3 seconds
- [ ] Search results load under 2 seconds
- [ ] No memory leaks on restaurant list scroll

---

## Post-Launch (first week)

- [ ] Monitor crash reports (EAS Updates or Sentry)
- [ ] Monitor analytics funnel drop-offs
- [ ] Respond to App Store reviews within 24h
- [ ] Collect feedback from beta users (S-58 feedback form)
- [ ] Fix any critical bugs same-day
