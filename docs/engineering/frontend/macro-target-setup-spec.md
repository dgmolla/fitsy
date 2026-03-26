# Macro Target Setup Screen — Spec

**Sprint**: S-55
**Owner**: Frontend Engineer
**Status**: Approved

---

## Overview

A one-time onboarding step that captures the user's daily macro targets (protein, carbs, fat) and persists them to AsyncStorage. On subsequent app launches the targets are pre-loaded into the search screen so the user can start searching immediately.

The screen is shown once: right after a new user registers and sees the welcome screen, before they reach the search tab. Returning users who already have targets stored bypass the screen entirely. Targets can also be edited later from the Profile screen (S-56).

---

## Onboarding Flow

```mermaid
flowchart TD
    A([App Launch]) --> B{Token\nstored?}
    B -- No --> C[/auth/login]
    C --> D[/auth/register]
    D --> E[/onboarding\nWelcome screen]
    E -- Set up my macros --> F[/macro-setup\nMacro Target Setup]
    E -- Skip for now --> G
    F -- Save & Continue --> G[(AsyncStorage\n@fitsy/macro_targets)]
    G --> H[/(tabs)/search]

    B -- Yes --> I{Macro targets\nstored?}
    I -- No --> F
    I -- Yes --> H

    style F fill:#2D7D46,color:#fff
    style G fill:#F3F4F6,color:#111
```

---

## Screen: `/macro-setup`

**File**: `apps/mobile/app/macro-setup.tsx`

### Fields

| Field | Label | Type | Validation |
|-------|-------|------|-----------|
| protein | Protein (g) | numeric | required, > 0, integer |
| carbs | Carbs (g) | numeric | required, > 0, integer |
| fat | Fat (g) | numeric | required, > 0, integer |

Calories are intentionally omitted on this screen — they are derived from the three macros on the search screen.

### Preset Shortcuts

Three preset buttons (Cut / Bulk / Maintain) auto-fill all three fields using the existing `PRESETS` constants from `apps/mobile/lib/macroPresets.ts`.

### Persistence

```ts
const MACRO_TARGETS_KEY = '@fitsy/macro_targets';

interface StoredMacroTargets {
  protein: string; // numeric string, e.g. "150"
  carbs: string;
  fat: string;
}
```

Key: `@fitsy/macro_targets`. The helper `saveMacroTargets` in `apps/mobile/lib/macroStorage.ts` writes to AsyncStorage. On next app launch, `index.tsx` calls `getMacroTargets` and redirects to `/macro-setup` if null.

### Validation Rules

- All three fields are required.
- Value must parse to a positive number (`> 0`).
- Inline error message shown below the field on blur or on submit attempt.

### Navigation

- On successful save: `router.replace('/(tabs)/search')`
- "Skip for now" link: `router.replace('/(tabs)/search')` (no write — the user will be prompted again on next cold launch until they save)

---

## New File: `apps/mobile/lib/macroStorage.ts`

Encapsulates all AsyncStorage reads/writes for macro targets, keeping screen files thin.

```ts
export interface StoredMacroTargets {
  protein: string;
  carbs: string;
  fat: string;
}

export async function getMacroTargets(): Promise<StoredMacroTargets | null>
export async function saveMacroTargets(targets: StoredMacroTargets): Promise<void>
export async function clearMacroTargets(): Promise<void>
```

---

## Changes to `apps/mobile/app/index.tsx`

The root index now checks for macro targets after the auth token check:

```
token present?
  yes → macro targets present? → yes → /(tabs)/search
                               → no  → /macro-setup
  no  → /auth/login
```

---

## Shared Types

`packages/shared/src/types/index.ts` already exports `MacroTargets` (with numeric fields). The storage layer uses string fields to match the `MacroValues` convention used in `macroPresets.ts` — no changes needed to shared types.

---

## Tests

New test file: `apps/mobile/lib/macroStorage.test.ts`

- `getMacroTargets` returns `null` when nothing is stored
- `getMacroTargets` returns parsed object after `saveMacroTargets`
- `clearMacroTargets` results in `null` from `getMacroTargets`
- `saveMacroTargets` overwrites previous value

---

## Accessibility

- Each input has an `accessibilityLabel` (e.g. `"Daily protein target in grams"`)
- Error messages use `accessibilityLiveRegion="polite"`
- Submit button disabled and labelled `"Fill in all macro targets to continue"` when form is invalid
- Minimum touch target: 44pt

---

## Out of Scope (S-56)

- Editing targets from the Profile screen
- Calories field (derived, not captured here)
- Body-weight / TDEE calculator
