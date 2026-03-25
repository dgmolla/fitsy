# Onboarding CTA Screen — Frontend Spec (S-37f)

## Goal

After a new user registers, show a one-time onboarding screen that
explains macro targets and provides a CTA to start searching.

## Trigger

`POST /api/auth/register` succeeds → `router.replace('/onboarding')`
(instead of direct to `/(tabs)/search`).

Login flow is unchanged — existing users go directly to search.

## Screen: `/onboarding`

```mermaid
flowchart TD
    A[Register success] --> B[/onboarding screen/]
    B --> C{User taps CTA}
    C --> D[/(tabs)/search]
    B --> E[Back button tapped]
    E --> D
```

### Content

- **Heading**: "You're in, {name}!" (or "You're in!" if no name)
- **Subtext**: "Fitsy finds restaurants near you with meals that match
  your protein, carb, and fat targets."
- **CTA button**: "Set up my macros" → `router.replace('/(tabs)/search')`
- **Skip link**: "Skip for now" → same destination

### Behaviour

- Screen is not part of the tab navigator — it lives at `app/onboarding.tsx`
- Hardware back button and swipe-back should also go to `/(tabs)/search`,
  not to the register screen (use `router.replace`, not `router.push`)

## Files

| File | Change |
|------|--------|
| `apps/mobile/app/onboarding.tsx` | New screen |
| `apps/mobile/app/auth/register.tsx` | Change redirect to `/onboarding` |
| `apps/mobile/lib/authClient.test.ts` | No change needed |

## Acceptance Criteria

- [ ] After registration, user lands on `/onboarding`
- [ ] CTA button navigates to `/(tabs)/search`
- [ ] Skip link navigates to `/(tabs)/search`
- [ ] Back navigation goes to `/(tabs)/search`, not register
- [ ] Heading uses user's name when available
