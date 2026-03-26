# S-53: Fix Mobile Crash — "Exception in Host Function"

**Sprint**: 8
**Role**: CTO
**Status**: In Progress
**Date**: 2026-03-25

---

## Problem Statement

The Fitsy app crashes on a physical device with `"Exception in host function"` after the
Expo SDK 52 → 54 upgrade (S-52). The crash surfaces at app boot, preventing any user from
reaching the auth or search screens.

---

## Root Cause Analysis

Two cooperating bugs cause the crash:

### Bug 1 — `@expo/vector-icons` not declared as a direct dependency (PRIMARY)

`apps/mobile/app/(tabs)/_layout.tsx` imports:

```ts
import { Ionicons } from '@expo/vector-icons';
```

But `@expo/vector-icons` is **not listed** in `apps/mobile/package.json` dependencies.
The package is available transitively through the root monorepo `node_modules` during local
Metro dev — so the crash doesn't appear in `expo start` on a simulator. However:

- EAS Build runs `npm ci` in a clean environment scoped to `apps/mobile/`.
- The physical device binary produced by EAS Build does not have the transitive package in
  the Metro bundle's module resolution path.
- At runtime, the `Ionicons` native module binding fails → **"Exception in host function"**.

### Bug 2 — `expo-secure-store` dead dependency (SECONDARY)

`expo-secure-store` is still listed in `apps/mobile/package.json` even though all usages
were replaced with `@react-native-async-storage/async-storage` in the prior sprint (S-52).

In React Native SDK 54 (New Architecture / Bridgeless), native modules are initialized
eagerly. A native module with a stale or mis-versioned binding can throw during JSI host
function setup → **"Exception in host function"**.

Removing the unused dependency eliminates this risk entirely.

---

## Boot and Navigation Flow

```mermaid
flowchart TD
    A[App Launch] --> B[RootLayout: _layout.tsx]
    B --> C[SafeAreaProvider]
    C --> D[Stack Navigator]
    D --> E[index.tsx: token check]
    E -->|AsyncStorage.getItem| F{Token found?}
    F -->|Yes| G[Redirect → /(tabs)/search]
    F -->|No| H[Redirect → /auth/login]
    F -->|Loading| I[ActivityIndicator]
    G --> J[TabLayout: (tabs)/_layout.tsx]
    J -->|renders Ionicons from @expo/vector-icons| K[Tabs Navigator]
    K --> L[SearchScreen]
    K --> M[ProfileScreen]
    H --> N[AuthLayout: auth/_layout.tsx]
    N --> O[LoginScreen]
    O -->|register| P[RegisterScreen]
    P -->|success| Q[OnboardingScreen]
    Q -->|CTA / skip| L

    style J fill:#fee2e2,stroke:#dc2626
    style B fill:#d1fae5,stroke:#2d7d46
```

The crash occurs at node **J** — when `TabLayout` renders `<Ionicons>` and the native
vector icons module is unavailable in the physical device build.

---

## Fix

### 1. Add `@expo/vector-icons` to explicit dependencies

```json
"@expo/vector-icons": "^14.0.0"
```

SDK 54 ships with `@expo/vector-icons` `^14`. Declaring it explicitly ensures EAS Build
includes it in the native bundle and Metro resolves it deterministically.

### 2. Remove `expo-secure-store` from dependencies

`expo-secure-store` is no longer imported anywhere in the codebase. Removing it:
- Eliminates the stale native module initialization path.
- Reduces binary size.
- Makes `package.json` an accurate reflection of actual usage.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/mobile/package.json` | Add `@expo/vector-icons ^14.0.0`; remove `expo-secure-store` |

---

## Testing Plan

- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `bash scripts/structural-tests.sh` passes
- [ ] `npm test` passes in `apps/mobile`
- [ ] `expo start` — app boots on iOS Simulator without crash
- [ ] EAS Build (via `eas build --platform ios --profile preview`) — physical device does not crash on boot
- [ ] Tab navigation renders `Ionicons` (search + person icons visible)
- [ ] Auth flow works end-to-end: login → search screen

---

## Non-Goals

- This ticket does not change navigation logic or layout structure.
- GPS integration (S-54) and JWT middleware (S-57) are separate tickets.
