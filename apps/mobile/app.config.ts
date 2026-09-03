import type { ExpoConfig } from "expo/config";

// ─── Publish env guard ───────────────────────────────────────────────────────
// Every EXPO_PUBLIC_* value is inlined into the JS bundle and copied into the
// update manifest (`extra` below) at publish time. A publish from a shell
// without them - a fresh worktree with no `.env.local`, or `eas update` without
// `--environment production` - fails nothing: the bundle silently ships with the
// API pointed at localhost, Supabase unset and no RevenueCat key, so the paywall
// shows "Plans are still loading" forever. This bit production twice (2026-08
// and 2026-09-01), so a production export now refuses to proceed instead.
//
// Lives in this file (not lib/) because @expo/config evaluates app.config.ts
// standalone and cannot resolve sibling .ts imports. Pure helpers are exported
// for lib/publishEnvGuard.test.ts.

/** Public env every production bundle needs to function at all. */
export const REQUIRED_PUBLIC_ENV = [
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_REVENUECAT_IOS_KEY",
  "EXPO_PUBLIC_POSTHOG_API_KEY",
] as const;

/** Escape hatch for a deliberate keyless export (never for a real publish). */
export const PUBLISH_ENV_OVERRIDE_VAR = "FITSY_ALLOW_MISSING_PUBLIC_ENV";

export type PublishEnv = Record<string, string | undefined>;

export function missingPublicEnv(env: PublishEnv): string[] {
  return REQUIRED_PUBLIC_ENV.filter((name) => !env[name]?.trim());
}

/**
 * Enforce only on a production export outside EAS Build. Local `expo start`
 * runs with NODE_ENV=development and needs no guard; EAS Build workers set
 * EAS_BUILD=true and inject env per build profile (dev-client builds read
 * `extra` from the dev server / update manifest at runtime, not the binary).
 */
export function shouldEnforcePublishEnv(env: PublishEnv): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.EAS_BUILD === "true") return false;
  if (env[PUBLISH_ENV_OVERRIDE_VAR] === "1") return false;
  return true;
}

export function assertPublishEnv(env: PublishEnv): void {
  if (!shouldEnforcePublishEnv(env)) return;
  const missing = missingPublicEnv(env);
  if (missing.length === 0) return;
  throw new Error(
    `[fitsy] Refusing to export a production bundle without public env. Missing: ${missing.join(", ")}.\n` +
      "Publish with `eas update --branch <branch> --environment production` so EAS injects the env,\n" +
      "or run from a checkout that has apps/mobile/.env.local.\n" +
      `Deliberate keyless export only: ${PUBLISH_ENV_OVERRIDE_VAR}=1.`,
  );
}

assertPublishEnv(process.env);

// Google Sign-In (expo-auth-session) redirects to the iOS OAuth client's
// reversed-client-id custom scheme. It must be a registered URL scheme or the
// redirect can't route back into the app. Derived from the env client id so it
// stays in sync; registered alongside "fitsy" via the scheme array (Expo
// appends each on prebuild, so the app + dev-client schemes are preserved).
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const reversedGoogleScheme = googleIosClientId
  ? `com.googleusercontent.apps.${googleIosClientId.replace(/\.apps\.googleusercontent\.com$/, "")}`
  : undefined;

const config: ExpoConfig = {
  name: "Fitsy",
  slug: "fitsy",
  scheme: reversedGoogleScheme ? ["fitsy", reversedGoogleScheme] : "fitsy",
  version: "1.0.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  icon: "./assets/icon.png",
  splash: {
    backgroundColor: "#FDFBF7",
    resizeMode: "contain",
  },
  ios: {
    // Must match App Store Connect (and the RevenueCat App Store app) exactly.
    bundleIdentifier: "com.fitsy.mobile",
    buildNumber: "4",
    supportsTablet: false,
    splash: {
      backgroundColor: "#FDFBF7",
    },
    infoPlist: {
      // We use only exempt encryption (HTTPS/standard crypto). Declaring this
      // auto-answers App Store Connect's export-compliance question on every
      // TestFlight/App Store upload instead of prompting each time.
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  plugins: [
    "expo-router",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Fitsy uses your location to find restaurants near you.",
      },
    ],
    "expo-apple-authentication",
    "expo-web-browser",
    "expo-notifications",
  ],
  updates: {
    url: "https://u.expo.dev/a204190c-0b71-4c31-b126-f3bc62d1c4ee",
  },
  runtimeVersion: {
    policy: "appVersion",
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000",
    // RevenueCat public SDK keys (per-platform "App specific keys" from the
    // RevenueCat dashboard → Project settings → API keys). Read at runtime via
    // expo-constants in lib/purchases.ts. Never hardcode — set in env.
    revenueCat: {
      ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
      android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
      // Test Store key — selected automatically in dev builds (see lib/purchases.ts).
      test: process.env.EXPO_PUBLIC_REVENUECAT_TEST_KEY,
    },
    eas: {
      projectId: "a204190c-0b71-4c31-b126-f3bc62d1c4ee",
    },
  },
};

export default config;
