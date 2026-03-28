import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Fitsy",
  slug: "fitsy",
  scheme: "fitsy",
  version: "1.0.0",
  orientation: "portrait",
  platforms: ["ios", "android"],

  plugins: [
    "expo-router",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Fitsy uses your location to find restaurants near you.",
      },
    ],
  ],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000",
    eas: {
      projectId: "a204190c-0b71-4c31-b126-f3bc62d1c4ee",
    },
  },
};

export default config;
