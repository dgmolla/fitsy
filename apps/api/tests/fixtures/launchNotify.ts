/**
 * Shared fixtures for the launchNotify test files. Lives outside lib/ so it
 * is neither run as a test nor counted for coverage.
 */
export const LA = { lat: 34.05, lng: -118.24 };

// Onboarding row: account-linked, coarse LA location.
export const ONBOARDING_LA = {
  id: "wl-app",
  userId: "user-1",
  email: "app@fitsy.org",
  lat: 34.1,
  lng: -118.2,
  city: "Los Angeles",
  notifyAttempts: 0,
  user: { pushToken: "ExponentPushToken[abc]" },
};

// Onboarding row far away (NYC).
export const ONBOARDING_NYC = {
  ...ONBOARDING_LA,
  id: "wl-nyc",
  userId: "user-2",
  email: "nyc@fitsy.org",
  lat: 40.7,
  lng: -74.0,
  city: "New York",
};

// Account-linked row in LA whose user never granted push permission.
export const ONBOARDING_NO_TOKEN = {
  ...ONBOARDING_LA,
  id: "wl-notoken",
  userId: "user-3",
  email: "notoken@fitsy.org",
  user: { pushToken: null },
};

// Website row: no account, no location.
export const WEB = {
  id: "wl-web",
  userId: null,
  email: "web@fitsy.org",
  lat: null,
  lng: null,
  city: null,
  notifyAttempts: 0,
  user: null,
};
