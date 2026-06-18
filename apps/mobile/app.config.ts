import type { ExpoConfig } from "expo/config";

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
  splash: {
    backgroundColor: "#FDFBF7",
    resizeMode: "contain",
  },
  ios: {
    // Must match App Store Connect (and the RevenueCat App Store app) exactly.
    bundleIdentifier: "com.fitsy.mobile",
    buildNumber: "1",
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
