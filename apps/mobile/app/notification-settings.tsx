import React, { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useReminders } from '@/lib/useReminders';
import { usePurchases } from '@/lib/usePurchases';
import { getNotificationPermission, requestPermissionsAsync } from '@/lib/useNotifications';
import type { ReminderPreferences } from '@/lib/notificationPlan';

export default function NotificationSettings() {
  const { userId, preferences, scheduled, save } = useReminders();
  const { entitled, showManageSubscriptions } = usePurchases();
  const [permission, setPermission] = useState('undetermined');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const read = () => { void getNotificationPermission().then(setPermission); };
    read();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') read(); });
    return () => sub.remove();
  }, []);

  async function change(kind: keyof ReminderPreferences, enabled: boolean) {
    if (busy || !userId) return;
    setBusy(true);
    try {
      if (enabled) {
        const result = await requestPermissionsAsync(); setPermission(result.status);
        if (result.status !== 'granted') {
          Alert.alert('Notifications are off', 'Allow Fitsy notifications in your device settings to receive reminders.', [
            { text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
          ]);
          return;
        }
      }
      await save({ ...preferences, [kind]: enabled });
    } catch { Alert.alert('Could not update reminders', 'Please try again.'); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.content}>
    <Pressable onPress={() => router.back()} accessibilityRole="button" testID="reminders-back"><Text style={s.link}>Back</Text></Pressable>
    <Text style={TEXT.headline}>Reminders that fit.</Text>
    <Text style={s.body}>A little help planning your next meal. Change these anytime.</Text>
    <Text style={s.body} testID="reminder-permission">{permission === 'granted' ? 'Device notifications allowed' : 'Device notifications are off'}</Text>
    {(['meals', 'trial'] as const).map(kind => <View key={kind} style={s.card}>
      <View style={s.copy}><Text style={s.title}>{kind === 'meals' ? 'Meal inspiration' : 'Trial renewal reminder'}</Text>
        <Text style={s.body}>{kind === 'meals' ? 'Tuesday and Friday at 11:30, in your local time.' : 'A reminder before an eligible trial renews. Your actual store renewal date sets the timing.'}</Text></View>
      <Switch testID={`reminder-${kind}-toggle`} accessibilityLabel={kind === 'meals' ? 'Meal inspiration' : 'Trial renewal reminder'} value={preferences[kind]} disabled={busy || !userId} onValueChange={value => { void change(kind, value); }} trackColor={{ true: EDITORIAL.green }} />
    </View>)}
    <Text style={s.body}>At most one reminder per day. Quiet hours: 8pm–9am.</Text>
    {!userId && <Text style={s.body}>Sign in to choose reminders for your account.</Text>}
    {userId && entitled !== true && <Text style={s.body}>Reminders start with your active Fitsy subscription.</Text>}
    <Text style={s.title}>Coming up</Text>
    {!scheduled.length && <Text style={s.body} testID="reminders-empty">No upcoming reminders</Text>}
    {(['meal', 'trial'] as const).map(kind => {
      const next = scheduled.find(item => item.kind === kind);
      return next ? <Text key={kind} style={s.body} testID={`reminder-next-${kind}`}>{kind === 'meal' ? 'Meal inspiration' : 'Trial renewal'}: {new Date(next.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text> : null;
    })}
    <Pressable onPress={() => { void showManageSubscriptions(); }} accessibilityRole="button" testID="reminders-manage-subscription"><Text style={s.link}>Manage subscription</Text></Pressable>
    <Pressable onPress={() => { void Linking.openSettings(); }} accessibilityRole="button" testID="reminders-device-settings"><Text style={s.link}>Device notification settings</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream }, content: { padding: 24, gap: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: EDITORIAL.creamCard, padding: 18, borderRadius: 18 },
  copy: { flex: 1, gap: 6 }, title: { ...TEXT.subtitle, color: EDITORIAL.text },
  body: { ...TEXT.bodySmall, color: EDITORIAL.textSoft }, link: { ...TEXT.body, color: EDITORIAL.green, paddingVertical: 6 },
});
