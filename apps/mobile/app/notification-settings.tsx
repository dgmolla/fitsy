import React, { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useReminders } from '@/lib/useReminders';
import { usePurchases } from '@/lib/usePurchases';
import { getNotificationPermission, requestPermissionsAsync } from '@/lib/useNotifications';
import { clearDevTrialReminder, scheduleDevTrialReminder, showDevMissedTrialReminder } from '@/lib/devTrialReminderProbe';

export default function NotificationSettingsScreen() {
  const { userId, preferences, scheduled, save } = useReminders();
  const { entitled, customerInfo, showManageSubscriptions } = usePurchases();
  const trial = customerInfo?.entitlements.all.pro;
  const trialEnd = trial?.isActive && trial.periodType === 'TRIAL' && trial.expirationDate && Number.isFinite(Date.parse(trial.expirationDate))
    ? new Date(trial.expirationDate).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  const [permission, setPermission] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<string>();
  useEffect(() => {
    let live = true;
    const update = () => { void getNotificationPermission().then(value => { if (live) setPermission(value); }); };
    update();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { live = false; listener.remove(); };
  }, []);
  async function enable() {
    if (busy || !userId) return;
    setBusy(true);
    try {
      const result = await requestPermissionsAsync();
      setPermission(result.status);
      if (result.status === 'granted') await save({ meals: true, trial: true });
      else Alert.alert('Notifications are off', 'You can allow Fitsy notifications in your device settings.');
    } catch { Alert.alert('Could not enable reminders', 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.content}>
    <Pressable style={s.action} onPress={() => router.back()} accessibilityRole="button" testID="reminders-back"><Text style={s.link}>Back</Text></Pressable>
    <Text style={TEXT.headline}>Notifications.</Text>
    <Text style={s.body}>Meal inspiration and a heads-up before an eligible trial renews.</Text>
    <View style={s.card}><Text style={s.title} testID="reminder-permission">{permission === 'granted' ? 'Device notifications allowed' : 'Device notifications are off'}</Text>
      <Text style={s.body}>Turn notifications on or off in your device settings.</Text>
      <Pressable style={s.action} onPress={() => { void Linking.openSettings(); }} accessibilityRole="button" testID="reminders-device-settings"><Text style={s.link}>Device notification settings</Text></Pressable>
    </View>
    {userId && (!preferences.meals || !preferences.trial) && <Pressable style={s.action} disabled={busy} onPress={() => { void enable(); }} accessibilityRole="button" testID="reminders-enable"><Text style={s.link}>{busy ? 'Asking…' : 'Remind me'}</Text></Pressable>}
    {userId && entitled !== true && <Text style={s.body}>Reminders start with your active Fitsy subscription.</Text>}
    {trialEnd && <Text style={s.body} testID="reminder-trial-end">Trial {trial?.willRenew ? 'renews' : 'ends'}: {trialEnd}</Text>}
    <Text style={s.title}>Upcoming reminders</Text>
    {!scheduled.length && <Text style={s.body} testID="reminders-empty">No upcoming reminders</Text>}
    {(['meal', 'trial'] as const).map(kind => {
      const next = scheduled.find(item => item.kind === kind);
      return next ? <Text key={kind} style={s.body} testID={`reminder-next-${kind}`}>{kind === 'meal' ? 'Meal inspiration' : 'Trial renewal'}: {new Date(next.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text> : null;
    })}
    {__DEV__ && <View style={s.card}>
      <Text style={s.title}>Development reminder probe</Text>
      <Text style={s.body}>Synthetic trial dates for reminder testing; does not change your subscription. {userId ? '' : 'Sign in to use this probe.'}</Text>
      <Pressable style={s.action} disabled={busy || !userId} onPress={() => { void scheduleDevTrialReminder(userId)
        .then(value => setProbe(`Native pending: ${value.count}; trial: ${value.scheduledFor ?? 'none'}`))
        .catch(error => setProbe(String(error))); }} accessibilityRole="button" testID="dev-reminder-schedule">
        <Text style={s.link}>Schedule test trial reminder</Text>
      </Pressable>
      <Pressable style={s.action} disabled={busy || !userId} onPress={() => { void clearDevTrialReminder(userId)
        .then(value => setProbe(`Native pending after clear: ${value.count}`))
        .catch(error => setProbe(String(error))); }} accessibilityRole="button" testID="dev-reminder-clear">
        <Text style={s.link}>Clear test reminders</Text>
      </Pressable>
      {probe && <Text style={s.body} testID="dev-reminder-result">{probe}</Text>}
      <Pressable style={s.action} disabled={busy || !userId} onPress={() => showDevMissedTrialReminder(userId)}
        accessibilityRole="button" testID="dev-reminder-missed-window">
        <Text style={s.link}>Show late opt-in alert (synthetic)</Text>
      </Pressable>
      <Pressable style={s.action} disabled={busy || !userId} onPress={() => {
        try { showDevMissedTrialReminder(userId, new Date(2026, 9, 30)); }
        catch (error) { setProbe(String(error)); }
      }} accessibilityRole="button" testID="dev-reminder-missed-dst">
        <Text style={s.link}>Show DST late opt-in alert (synthetic)</Text>
      </Pressable>
    </View>}
    <Pressable style={s.action} onPress={() => { void showManageSubscriptions(); }} accessibilityRole="button" testID="reminders-manage-subscription"><Text style={s.link}>Manage subscription</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream }, content: { padding: 24, gap: 18 },
  card: { gap: 12, backgroundColor: EDITORIAL.creamCard, padding: 18, borderRadius: 18 },
  action: { minHeight: 44, justifyContent: 'center' },
  title: { ...TEXT.subtitle, color: EDITORIAL.text },
  body: { ...TEXT.bodySmall, color: EDITORIAL.textMid }, link: { ...TEXT.body, color: EDITORIAL.green },
});
