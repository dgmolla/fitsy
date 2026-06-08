import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Fitsy",
  slug: "fitsy",
  scheme: "fitsy",
  version: "1.0.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  splash: {
    backgroundColor: "#FDFBF7",
    resizeMode: "contain",
  },
  ios: {
    bundleIdentifier: "app.fitsy.mobile",
    supportsTablet: false,
    splash: {
      backgroundColor: "#FDFBF7",
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
