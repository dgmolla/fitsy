# Fitsy E2E Flows (Maestro)

End-to-end tests for the Fitsy mobile app, written with [Maestro](https://maestro.mobile.dev).
Flows run against a live staging build connected to the staging API.

## Flows

| File | What it tests |
|------|--------------|
| `flows/onboarding.yaml` | New user registers and lands on the Search screen |
| `flows/search.yaml` | User enters macro targets and sees restaurant results (or graceful empty state) |
| `flows/restaurant-detail.yaml` | User taps a restaurant card and sees its menu with macro breakdown |

## Prerequisites

1. **Maestro CLI** installed:
   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   ```
2. An iOS Simulator (or Android emulator) running the Fitsy app build.
3. The app must be configured to point at the staging API
   (`EXPO_PUBLIC_API_URL` set in your `.env.local` or passed to `expo prebuild`).

## Running locally

Run all flows:

```bash
maestro test e2e/flows/
```

Run a single flow:

```bash
maestro test e2e/flows/onboarding.yaml
```

Run with a specific device:

```bash
maestro test --device <udid> e2e/flows/
```

## Viewing results

Failed flows upload screenshots to `~/.maestro/tests/`. In CI, these are
uploaded as a GitHub Actions artifact named `maestro-screenshots` and retained
for 7 days.

## Staging data

The `search.yaml` and `restaurant-detail.yaml` flows handle an empty staging
database gracefully — they assert on the empty-state UI rather than failing
when no restaurants are returned. Once the staging database is seeded, the
flows automatically exercise the full results path.

## CI

Flows run on every push to `main` via `.github/workflows/e2e-staging.yml` on a
`macos-latest` GitHub Actions runner. The workflow:

1. Builds the Expo iOS app with `expo prebuild`
2. Installs Maestro
3. Executes `maestro test e2e/flows/`
4. Uploads screenshots on failure
