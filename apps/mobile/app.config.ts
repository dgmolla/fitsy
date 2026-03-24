import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Fitsy",
  slug: "fitsy",
  scheme: "fitsy",
  version: "1.0.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000",
  },
};

export default config;
