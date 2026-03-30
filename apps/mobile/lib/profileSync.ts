import { api } from './api';
import { getStoredToken } from './authClient';
import { getOnboardingData, type OnboardingData } from './onboardingStorage';
import { getMacroTargets, saveMacroTargets, type StoredMacroTargets } from './macroStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProfileResponse } from '@fitsy/shared';

const ONBOARDING_KEY = '@fitsy/onboarding';

/**
 * Fetch the user's profile from the server.
 * Returns null on auth failure or network error.
 */
export async function fetchProfile(): Promise<ProfileResponse | null> {
  try {
    return await api.get<ProfileResponse>('/api/user/profile', true);
  } catch {
    return null;
  }
}

/**
 * Push local profile + macro targets to the server.
 * Fire-and-forget — silently swallows errors.
 */
export async function pushProfileToServer(): Promise<void> {
  try {
    const token = await getStoredToken();
    if (!token) return;

    const [onboarding, macros] = await Promise.all([
      getOnboardingData(),
      getMacroTargets(),
    ]);

    const body: Record<string, unknown> = {};

    if (onboarding.birthday) body.birthday = onboarding.birthday;
    if (onboarding.heightCm) body.heightCm = onboarding.heightCm;
    if (onboarding.weightKg) body.weightKg = onboarding.weightKg;
    if (onboarding.activity) body.activityLevel = onboarding.activity;
    if (onboarding.goal) body.goal = onboarding.goal;

    // Convert per-meal → daily (×3)
    if (macros) {
      const p = parseFloat(macros.protein);
      const c = parseFloat(macros.carbs);
      const f = parseFloat(macros.fat);
      const cal = parseFloat(macros.calories);
      if (!isNaN(p) && !isNaN(c) && !isNaN(f) && !isNaN(cal)) {
        body.macroTarget = {
          calories: Math.round(cal * 3),
          proteinG: Math.round(p * 3),
          carbsG: Math.round(c * 3),
          fatG: Math.round(f * 3),
        };
      }
    }

    if (Object.keys(body).length === 0) return;

    await api.patch('/api/user/profile', body, true);
  } catch {
    // Silent failure — data stays local
  }
}

/**
 * Pull the user's profile from the server and populate AsyncStorage.
 * Call after login to restore data on a new device.
 */
export async function pullProfileFromServer(): Promise<void> {
  try {
    const profile = await fetchProfile();
    if (!profile) return;

    // Write body stats to onboarding storage
    const onboarding: OnboardingData = {};
    if (profile.user.birthday !== null) onboarding.birthday = profile.user.birthday;
    if (profile.user.heightCm !== null) onboarding.heightCm = profile.user.heightCm;
    if (profile.user.weightKg !== null) onboarding.weightKg = profile.user.weightKg;
    if (profile.user.activityLevel !== null) onboarding.activity = profile.user.activityLevel;
    if (profile.user.goal !== null) onboarding.goal = profile.user.goal;

    if (Object.keys(onboarding).length > 0) {
      await AsyncStorage.setItem(ONBOARDING_KEY, JSON.stringify(onboarding));
    }

    // Convert daily → per-meal (÷3) and write to macro storage
    if (profile.macroTarget) {
      const perMeal: StoredMacroTargets = {
        protein: String(Math.round(profile.macroTarget.proteinG / 3)),
        carbs: String(Math.round(profile.macroTarget.carbsG / 3)),
        fat: String(Math.round(profile.macroTarget.fatG / 3)),
        calories: String(Math.round(profile.macroTarget.calories / 3)),
      };
      await saveMacroTargets(perMeal);
    }
  } catch {
    // Silent failure — use whatever is in local storage
  }
}
