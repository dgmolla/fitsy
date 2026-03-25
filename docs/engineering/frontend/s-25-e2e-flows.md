# S-25: Maestro E2E Flows — Search → Detail → Macro Match

## Overview

This spec defines the Maestro E2E test flows that validate the core user journey
against the staging environment: new user registration, macro-target search, and
restaurant detail with macro breakdown.

## Scope

| Flow | File | Depends On |
|------|------|------------|
| Onboarding | `e2e/flows/onboarding.yaml` | None |
| Search | `e2e/flows/search.yaml` | Seeded staging data or graceful empty state |
| Restaurant detail | `e2e/flows/restaurant-detail.yaml` | Seeded staging data |

## Test Flow Sequence

```mermaid
sequenceDiagram
    participant U as User (Maestro)
    participant A as App (Expo/iOS Simulator)
    participant S as Staging API

    note over U,S: Flow 1 — Onboarding
    U->>A: launchApp
    A->>U: Login screen visible
    U->>A: Tap "Create one" (navigate to register)
    A->>U: Register screen visible
    U->>A: Enter name, email, password
    U->>A: Tap "Create account"
    A->>S: POST /api/auth/register
    S-->>A: 201 + JWT token
    A->>U: Search screen visible (navigation complete)

    note over U,S: Flow 2 — Search
    U->>A: launchApp (already authenticated)
    A->>U: Search screen visible
    U->>A: Enter protein=40 in Protein (g) target field
    U->>A: Enter calories=600 in Cals target field
    A->>S: GET /api/restaurants?protein=40&calories=600
    S-->>A: Restaurant results (or empty state)
    A->>U: Results list visible OR empty state message visible

    note over U,S: Flow 3 — Restaurant Detail
    U->>A: launchApp (already authenticated)
    A->>U: Search screen visible
    U->>A: Apply "Cut (2000 kcal)" preset
    A->>S: GET /api/restaurants?protein=...&calories=...
    S-->>A: Restaurant results list
    A->>U: First restaurant card visible
    U->>A: Tap first restaurant card
    A->>S: GET /api/restaurants/:id/menu
    S-->>A: Menu items with macro data
    A->>U: Restaurant detail screen with menu items
    A->>U: Macro breakdown text visible (P: ... C: ... F: ...)
```

## Element Selectors

Flows use `accessibilityLabel` attributes set on components. These are stable,
implementation-agnostic identifiers that do not change with visual redesigns.

| Screen | Element | Accessibility Label |
|--------|---------|-------------------|
| Login | Email input | `Email address` |
| Login | Password input | `Password` |
| Login | Submit button | `Log in` |
| Login | Nav to register | `Create an account` |
| Register | Name input | `Full name` |
| Register | Email input | `Email address` |
| Register | Password input | `Password` |
| Register | Submit button | `Create account` |
| Search | Protein input | `Protein (g) target` |
| Search | Calories input | `Cals target` |
| Search | Preset button | `Apply Cut (2000 kcal) preset` |
| Search | Loading spinner | `Loading restaurants` |
| Search | Restaurant card | `View menu for {name}` (dynamic) |
| Restaurant | Loading spinner | `Loading menu` |

## Staging Data Requirements

The search and detail flows assume the staging database is seeded with at least
one restaurant that has menu items with macro data. The flows handle the empty
state gracefully — if no results appear, `search.yaml` asserts the empty state
message instead of failing.

## Running Locally

```bash
maestro test e2e/flows/
```

See `e2e/README.md` for full setup instructions.

## CI Integration

Flows run post-merge on `main` via `.github/workflows/e2e-staging.yml` using a
macOS GitHub Actions runner with a pre-built Expo iOS simulator build. The
`MAESTRO_APP_ID` env var is set to `com.fitsy.app`.
