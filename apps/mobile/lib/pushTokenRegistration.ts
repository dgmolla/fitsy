import { api } from './api';
import { getExpoPushTokenAsync } from './useNotifications';

export async function registerExpoPushToken(userId: string): Promise<void> {
  try {
    const token = await getExpoPushTokenAsync();
    if (token) await api.post('/api/user/push-token', { token }, true, userId);
  } catch {
    // Local reminders do not require a push token.
  }
}
