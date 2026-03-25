# Feedback Loop MVP

## Problem

Fitsy has no structured way to collect user feedback after launch. Without a
feedback channel, critical bugs go unreported, feature priorities are based on
guesswork, and users who hit friction silently churn. We need the simplest
possible loop — in-app capture → structured triage → spec → sprint — before
the first beta cohort lands.

## Solution

Add a persistent "Send Feedback" button in the mobile app that opens
`mailto:feedback@fitsy.app` (or a Typeform link if email is too high-friction
post-launch). Incoming feedback is triaged weekly by the PM using the playbook
in `docs/product/feedback-triage.md`, converted to typed tickets, and routed
into the sprint backlog.

The in-app button is a frontend concern owned by the mobile engineer. This spec
covers the product definition (placement, behavior, destination URL) and the
full triage system. The button implementation ships separately as **S-38f**.

### In-App Button

| Attribute | Value |
|-----------|-------|
| Label | "Send Feedback" |
| Placement | Settings screen, primary list section; also accessible from the main tab bar "…" overflow menu |
| Action | Opens `mailto:feedback@fitsy.app?subject=Fitsy%20Feedback` in the device mail client, OR navigates to the Typeform URL (configured via remote config so we can swap without a release) |
| Platform | iOS and Android |
| Auth gate | None — available to all users, free and paid |

### Feedback Destination (MVP)

Use `mailto:feedback@fitsy.app` for MVP. If open rates are low after two
sprints, switch to a Typeform URL. The URL is stored in a remote config value
(`FEEDBACK_URL`) so it can be updated without an app release.

## Edge Cases

1. Device has no mail client configured — `mailto:` will silently fail on some
   Android devices. The button should still open the intent; if no app handles
   it, the OS shows its own "no app found" error. No special handling needed
   for MVP.
2. User submits duplicate feedback — triager deduplicates during weekly triage;
   no in-app deduplication needed.
3. Typeform URL is unavailable (network error) — WebView returns error page;
   out of scope for MVP.
4. High feedback volume — triage SLA targets in the playbook are per-sprint;
   if volume exceeds capacity, backlog overflow is handled during sprint review.

## Out of Scope

- In-app feedback form (text field + submit) — adds engineering complexity;
  re-evaluate after MVP.
- Screenshot attachment — deferred.
- Automated categorization of incoming email — deferred.
- In-app ratings / star prompts (App Store review requests) — separate task.
- Feedback analytics dashboard — post-MVP.
- Real-time response to individual users — SLA targets are batch, not
  individual DMs.

---

## Diagrams

```mermaid
flowchart TD
    A([User opens app]) --> B[Navigates to Settings or overflow menu]
    B --> C[Taps 'Send Feedback']
    C --> D{Feedback URL type}
    D -->|mailto| E[Device mail client opens\nTo: feedback@fitsy.app]
    D -->|Typeform| F[In-app WebView opens\nTypeform form]
    E --> G[User writes & sends email]
    F --> H[User fills & submits form]
    G --> I[(feedback@fitsy.app inbox)]
    H --> I
    I --> J[PM runs weekly triage\nsee feedback-triage.md]
    J --> K{Category}
    K -->|Bug| L[Create bug ticket\nnext sprint]
    K -->|Feature request| M[Add to backlog\nlink to OKR]
    K -->|Content issue| N[Create content ticket\nfor data team]
    K -->|Compliment| O[Note what's working\nshare with team]
    L --> P[Sprint backlog]
    M --> P
    N --> P
    P --> Q[Sprint planning → implementation → release]
    Q --> A
```

---

## Approach

1. PM defines button placement, label, and destination URL (this spec).
2. Mobile engineer implements the button in the Settings screen and overflow
   menu, reading `FEEDBACK_URL` from remote config (S-38f).
3. PM sets up `feedback@fitsy.app` email alias forwarding to the founder's
   inbox before first beta invite goes out.
4. PM triages weekly using `docs/product/feedback-triage.md`.

## Interface

The mobile engineer should expose a single utility function:

```
openFeedback() → void
```

It reads `FEEDBACK_URL` from remote config (fallback:
`mailto:feedback@fitsy.app?subject=Fitsy%20Feedback`) and calls
`Linking.openURL(url)`. No props, no return value, no state.

## Constraints

- Button must be visible without scrolling on a standard Settings screen
  (primary section, not buried at the bottom).
- `FEEDBACK_URL` must be swappable via remote config without an app release.
- No user data (email, name, macro history) is pre-filled or attached
  automatically — privacy by default.
- Implementation is gated on S-38f; this spec is the prerequisite.

---

## Acceptance Criteria

- [ ] "Send Feedback" button appears in Settings screen primary section on iOS
  and Android.
- [ ] Tapping the button opens `mailto:feedback@fitsy.app` in the device mail
  client (default configuration).
- [ ] If `FEEDBACK_URL` remote config value is set to a Typeform URL, tapping
  the button opens that URL instead.
- [ ] Button is accessible to both free and paid users.
- [ ] No user PII is pre-filled or attached to the feedback submission.
- [ ] `docs/product/feedback-triage.md` exists and PM has run at least one
  triage session using it before beta launch.

## Success Metrics

| Metric | MVP target |
|--------|------------|
| Feedback submissions per active user per month | >= 0.05 (1 in 20 users sends feedback monthly) |
| Triage lag (time from submission to categorized ticket) | <= 7 days |
| Bugs caught via feedback before user churn | track qualitatively in sprint retro |

---

## Implementation Note — S-38f

The in-app button described above requires a **separate frontend PR (S-38f)**
owned by the mobile engineer. This spec is the product definition; S-38f is
the implementation ticket. Do not merge S-38f without this spec being approved.
