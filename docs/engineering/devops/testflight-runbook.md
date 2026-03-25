# TestFlight Beta Build Runbook

**Task**: S-51
**Owner**: CTO
**Last updated**: 2026-03-25

## Overview

This runbook covers the full EAS Build + TestFlight distribution setup for Fitsy iOS beta.

```mermaid
flowchart LR
    A[git tag v*] --> B[eas-build.yml triggered]
    B --> C[eas build --platform ios]
    C --> D[EAS Cloud Build]
    D --> E[.ipa artifact]
    E --> F[eas submit --platform ios]
    F --> G[TestFlight processing]
    G --> H[Internal test group notified]
```

---

## Prerequisites

### Apple Developer Account
- Active Apple Developer Program membership ($99/yr)
- App ID registered: `com.fitsy.app`
- App created in App Store Connect: **Fitsy**

### EAS CLI (local setup)
```bash
npm install -g eas-cli
eas login          # authenticate with Expo account
eas whoami         # verify
```

### Required Secrets (GitHub + EAS)

| Secret | Location | Purpose |
|--------|----------|---------|
| `EXPO_TOKEN` | GitHub Actions secret | EAS CLI auth in CI |
| `APPLE_ID` | EAS secret (`eas secret:create`) | App Store Connect login |
| `APPLE_APP_SPECIFIC_PASSWORD` | EAS secret | ASC API (2FA bypass) |
| `ASC_APP_ID` | EAS secret | App Store Connect app numeric ID |

Add EAS secrets:
```bash
eas secret:create --scope project --name APPLE_ID --value "your@apple.id"
eas secret:create --scope project --name APPLE_APP_SPECIFIC_PASSWORD --value "xxxx-xxxx-xxxx-xxxx"
eas secret:create --scope project --name ASC_APP_ID --value "1234567890"
```

Add GitHub secret:
```
Settings → Secrets and variables → Actions → New repository secret
Name: EXPO_TOKEN
Value: <token from expo.dev/accounts/[username]/settings/access-tokens>
```

---

## One-Time Mobile Setup (Frontend Agent)

> **Frontend ticket required** — CTO does not own `apps/mobile/`. The following must be done by the frontend agent before the workflow can succeed.

### 1. Add `apps/mobile/eas.json`
```json
{
  "cli": {
    "version": ">= 10.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": false
      }
    },
    "production": {
      "ios": {
        "buildConfiguration": "Release"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### 2. Update `apps/mobile/app.config.ts`
Add explicit bundle identifier and iOS config:
```typescript
// In the config object:
ios: {
  bundleIdentifier: "com.fitsy.app",
  buildNumber: "1",
  supportsTablet: false,
},
```

---

## CI/CD: Automated Builds (`.github/workflows/eas-build.yml`)

The workflow triggers on version tags (`v*.*.*`). It:
1. Installs EAS CLI
2. Runs `eas build --platform ios --profile production --non-interactive`
3. Uploads the build to TestFlight via `eas submit`

See `.github/workflows/eas-build.yml` for the full workflow definition.

---

## Manual Build (when CI is not available)

```bash
cd apps/mobile

# Build for TestFlight (internal distribution)
eas build --platform ios --profile preview

# Submit to TestFlight (after build completes)
eas submit --platform ios --latest
```

Monitor build at: https://expo.dev/accounts/[username]/projects/fitsy/builds

---

## TestFlight Internal Test Group Setup

1. Go to App Store Connect → TestFlight → Internal Testing
2. Create group: **Fitsy Beta**
3. Add testers by Apple ID (up to 100 internal testers)
4. Once EAS submits the build, it appears under TestFlight builds
5. Apple processes the build (~5–15 min for internal)
6. Assign the build to the **Fitsy Beta** group
7. Testers receive TestFlight invite email

---

## Troubleshooting

### Build fails with "No bundle identifier"
Frontend ticket not complete — `app.config.ts` missing `ios.bundleIdentifier`.

### `eas submit` fails with authentication error
Verify `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` EAS secrets are set:
```bash
eas secret:list
```

### Build queued but not starting
EAS free tier has limited concurrent builds. Check queue at expo.dev.

### TestFlight shows "Missing Compliance"
Add to `apps/mobile/app.config.ts`:
```typescript
ios: {
  infoPlist: {
    ITSAppUsesNonExemptEncryption: false,
  },
}
```
