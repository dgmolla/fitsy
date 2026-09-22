import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { WelcomeActions } from '@/components/WelcomeActions';
import { openPurchasedDestination } from '@/lib/paywallJourney';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { usePurchases } from '@/lib/usePurchases';
import { saveReminderPreferences } from '@/lib/notificationSchedule';
import { getExpoPushTokenAsync, requestPermissionsAsync } from '@/lib/useNotifications';
import {
  trackReminderAction, trackNotificationPermissionDenied, trackNotificationPermissionGranted,
  trackNotificationPrimingAllowTapped, trackNotificationPrimingShown, trackNotificationPrimingSkipTapped,
} from '@/lib/analytics';

/** Permission follows purchase and explicitly enables the two basic reminders.
 * A trial reminder is only scheduled from verified renewal data by ReminderProvider. */
export default function NotificationPermissionScreen() {
  const navigation = useNavigation();
  const { customerInfo } = usePurchases();
  const trial = customerInfo?.entitlements.all.pro;
  const hasTrial = trial?.isActive && trial.periodType === 'TRIAL' && trial.willRenew;
  const [busy, setBusy] = useState(false);
  useEffect(() => { trackNotificationPrimingShown(); }, []);

  async function registerPushToken() {
    try { const token = await getExpoPushTokenAsync(); if (token) await api.post('/api/user/push-token', { token }); }
    catch { /* Local reminders do not require an APNs token. */ }
  }
  async function handleAllow() {
    if (busy) return;
    setBusy(true);
    trackNotificationPrimingAllowTapped();
    try {
      const { status } = await requestPermissionsAsync();
      if (status === 'granted') {
        trackNotificationPermissionGranted();
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await saveReminderPreferences(session.user.id, { meals: true, trial: true });
          trackReminderAction({ action: 'preferences_changed', meals: true, trial: true });
        }
        void registerPushToken();
      } else trackNotificationPermissionDenied();
    } catch { /* An unavailable permission prompt never blocks the purchased meal. */ }
    finally { void openPurchasedDestination(navigation); }
  }
  function handleSkip() {
    if (busy) return;
    trackNotificationPrimingSkipTapped();
    void openPurchasedDestination(navigation);
  }
  return <WelcomeScreen progress={1} title={"Make room for\nyour next meal."} subtitle="A little help to keep your goals in view."
    canContinue={!busy} onContinue={handleAllow} showBack={false}
    beforeTitle={<View style={s.success}><View style={s.tick}><Ionicons name="checkmark" size={22} color={EDITORIAL.greenAccent} /></View><Text style={s.successText}>You're in</Text></View>}
    footerContent={<WelcomeActions label={busy ? 'Asking…' : 'Remind me'} onPress={handleAllow} disabled={busy} testID="notification-allow"
      secondaryLabel="Not now" onSecondary={handleSkip} secondaryTestID="notification-skip" />}>
    <View style={s.card} testID={hasTrial ? 'notification-trial-benefit' : 'notification-meal-benefit'}>
      <View style={s.cardTop}><Ionicons name="notifications-outline" size={32} color={EDITORIAL.greenAccent} /><Text style={s.optional}>Optional</Text></View>
      <Text style={s.cardTitle}>{hasTrial ? 'Before your trial ends' : 'Meal inspiration'}</Text>
      <Text style={s.cardBody}>{hasTrial ? 'A heads-up before your subscription renews.' : 'Occasional ideas for your next meal.'}</Text>
    </View>
    {hasTrial && <View style={s.row}><Text style={s.rowTitle}>Meal inspiration</Text><Text style={s.rowBody}>Occasional ideas for your next meal.</Text></View>}
    <Text style={s.quiet}>Notifications are optional.</Text>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  success: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  tick: { width: 28, height: 28, borderRadius: 14, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  successText: { ...TEXT.body, color: EDITORIAL.greenAccent },
  card: { padding: 22, borderRadius: 24, backgroundColor: EDITORIAL.greenAccentTint, marginTop: 4, gap: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  optional: { ...TEXT.bodySmall, color: EDITORIAL.green, borderWidth: 1, borderColor: EDITORIAL.greenAccentTint, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  cardTitle: { ...TEXT.title, fontSize: 25, lineHeight: 30 },
  cardBody: { ...TEXT.body, lineHeight: 22 },
  row: { gap: 6, marginTop: 28, borderBottomWidth: 1, borderColor: EDITORIAL.border, paddingBottom: 20 },
  rowTitle: { ...TEXT.body, color: EDITORIAL.green },
  rowBody: { ...TEXT.bodySmall },
  quiet: { ...TEXT.bodySmall, textAlign: 'center', marginTop: 24 },
});
