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
2. An iOS Simulator booted with the Fitsy app installed.
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

## Capturing screen recordings

Use `scripts/record-mobile-e2e.sh` to run all flows and record the iOS Simulator screen:

```bash
# 1. Boot a simulator and install the app
xcrun simctl boot "iPhone 15 Pro"
open -a Simulator
xcrun simctl install booted path/to/Fitsy.app

# 2. Record all flows
bash scripts/record-mobile-e2e.sh

# 3. Videos land in recordings/
ls recordings/
# fitsy-onboarding.mp4
# fitsy-search.mp4
# fitsy-restaurant-detail.mp4
```

To upload recordings to a GitHub Release automatically, set `GH_TOKEN`:

```bash
export GH_TOKEN=$(gh auth token)
bash scripts/record-mobile-e2e.sh --release-tag e2e-mobile-sprint7
```

The script prints GitHub Release download URLs to paste into a PR description.

## CI

### On-demand recordings (`.github/workflows/mobile-e2e.yml`)

Triggered manually via `workflow_dispatch`. Builds the app on a `macos-latest`
runner, boots a simulator, runs all Maestro flows with screen recording enabled,
and uploads `.mp4` files to both:

- GitHub Actions artifact (`mobile-e2e-recordings`, 30 day retention)
- GitHub Release (`e2e-mobile-sprint7`)

To trigger from the CLI:

```bash
gh workflow run mobile-e2e.yml
```

### Post-merge smoke test (`.github/workflows/e2e-staging.yml`)

Runs on every push to `main` without video capture — just pass/fail validation
against the staging environment. Screenshots on failure are uploaded as artifacts.

## Viewing results

- **Locally**: open `.mp4` files in `recordings/` with QuickTime or any video player
- **Remotely (phone)**: tap the GitHub Release download link — Safari on iOS streams `.mp4` directly
- **CI artifacts**: download from the Actions run → `mobile-e2e-recordings` artifact

## Staging data

The `search.yaml` and `restaurant-detail.yaml` flows handle an empty staging
database gracefully — they assert on the empty-state UI rather than failing
when no restaurants are returned. Once the staging database is seeded, the
flows automatically exercise the full results path.
