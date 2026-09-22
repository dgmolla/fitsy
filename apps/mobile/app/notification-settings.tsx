import React, { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useReminders } from '@/lib/useReminders';
import { usePurchases } from '@/lib/usePurchases';
import { getNotificationPermission, requestPermissionsAsync } from '@/lib/useNotifications';
import { showManageSubscriptions } from '@/lib/purchases';

export default function NotificationSettingsScreen() {
  const { userId, preferences, scheduled, save } = useReminders();
  const { entitled } = usePurchases();
  const [permission, setPermission] = useState<string>();
  const [busy, setBusy] = useState(false);
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
    <Text style={s.title}>Upcoming reminders</Text>
    {!scheduled.length && <Text style={s.body} testID="reminders-empty">No upcoming reminders</Text>}
    {(['meal', 'trial'] as const).map(kind => {
      const next = scheduled.find(item => item.kind === kind);
      return next ? <Text key={kind} style={s.body} testID={`reminder-next-${kind}`}>{kind === 'meal' ? 'Meal inspiration' : 'Trial renewal'}: {new Date(next.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text> : null;
    })}
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
