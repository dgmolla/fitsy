import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { ReminderAvailability } from '@/components/PaywallOfferTimeline';
import { readReminderPreferences } from './notificationSchedule';
import { getNotificationPermission } from './useNotifications';

/** Keep reminder evidence scoped to the visible checkout and current account. */
export function usePaywallReminderAvailability(focused: boolean, userId: string | null): ReminderAvailability {
  const [reminderState, setReminderState] = useState<{ userId: string; availability: ReminderAvailability } | null>(null);
  useEffect(() => {
    if (!focused || !userId) { setReminderState(null); return; }
    let active = true;
    let request = 0;
    const refresh = () => {
      const latest = ++request;
      setReminderState(null);
      void Promise.all([getNotificationPermission(), readReminderPreferences(userId, { throwOnError: true })])
        .then(([permission, preferences]) => {
          if (active && latest === request) setReminderState({ userId, availability: permission === 'denied' ? 'permission-off'
            : permission === 'granted' && preferences.trial ? 'enabled' : 'opt-in' });
        })
        .catch(() => { if (active && latest === request) setReminderState({ userId, availability: 'unavailable' }); });
    };
    refresh();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { active = false; listener.remove(); };
  }, [focused, userId]);
  return reminderState?.userId === userId ? reminderState.availability : 'unavailable';
}
