import { api } from './api';
import { getOnboardingData } from './onboardingStorage';

/** Saves the area chosen in onboarding to the launch waitlist for the signed-in account. Never throws; false means not joined (#1012). */
export async function joinSavedAreaWaitlist(): Promise<boolean> {
  try {
    const { area } = await getOnboardingData();
    if (!area) return false;
    await api.post('/api/waitlist', { lat: area.lat, lng: area.lng }, true);
    return true;
  } catch { return false; }
}
