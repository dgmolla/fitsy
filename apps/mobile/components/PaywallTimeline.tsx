import React, { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { canOfferTrialReminder } from '@/lib/notificationPlan';
import type { purchaseTerms } from '@/lib/purchaseTerms';

type Terms = ReturnType<typeof purchaseTerms>;
export function PaywallTimeline({ terms, compact = false, concise = false }: { terms: Terms; compact?: boolean; concise?: boolean }) {
  const reminderDay = terms?.trialDays ? terms.trialDays - 1 : null;
  const inBrowser = Platform.OS === 'web';
  const canRemind = !inBrowser && canOfferTrialReminder(terms);
  const [permission, setPermission] = useState<string | null>(null);
  useEffect(() => {
    if (inBrowser || !canRemind) return;
    let live = true;
    let request = 0;
    const refresh = () => {
      const latest = ++request;
      void Notifications.getPermissionsAsync()
        .then(value => { if (live && latest === request) setPermission(value.status); })
        .catch(() => { if (live && latest === request) setPermission('undetermined'); });
    };
    refresh();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { live = false; listener?.remove(); };
  }, [inBrowser, canRemind]);
  const rows = terms?.trial ? [
    { icon: 'lock-open-outline' as const, title: 'Day 1: trial access', body: concise ? 'Fitsy Pro starts.' : 'Start using Fitsy Pro.' },
    { icon: 'notifications-outline' as const, title: inBrowser ? 'Reminder unavailable in this browser' : !canRemind ? 'Reminder unavailable for this trial' : permission === 'denied' ? 'Reminders are off' : reminderDay ? `Day ${reminderDay}: optional reminder` : 'Reminder before trial end, if available',
      body: inBrowser ? (concise ? 'Use the mobile app for reminders.' : 'Trial notifications require the Fitsy mobile app.') : !canRemind ? (concise ? 'This trial ends before a reminder is possible.' : 'This trial is too short for a reminder before the cancellation deadline.') : permission === 'denied' ? (concise ? 'Turn on notifications in settings.' : 'Turn on notifications in device settings to receive one.') : concise ? 'If enabled and the store confirms your trial end.' : 'Requires permission and a store-confirmed trial end date.' },
    { icon: 'card-outline' as const, title: terms.trialDays ? `Day ${terms.trialDays}: first charge` : `After ${terms.trial}: first charge`, body: concise ? `${terms.recurring}, unless canceled at least 24 hours before trial end.` : `${terms.recurring} after the full trial period, unless canceled at least 24 hours before it ends.` },
  ] : [
    { icon: 'lock-open-outline' as const, title: terms ? 'Access starts today' : 'Your plan', body: terms ? (concise ? 'After purchase.' : 'Fitsy Pro begins after purchase.') : 'Store plans are loading.' },
    { icon: 'card-outline' as const, title: terms ? 'Your first payment' : 'Checking store terms', body: terms?.charge ?? 'Current prices and eligible offers appear when the store finishes loading.' },
    { icon: 'calendar-outline' as const, title: 'Renewal', body: terms ? (concise ? `${terms.recurring}. Cancel at least 24 hours before renewal.` : `${terms.recurring}. Cancel in subscription settings at least 24 hours before renewal.`) : 'Renewal terms appear with store prices.' },
  ];
  return <View style={[s.timeline, compact && s.timelineCompact]} testID="paywall-timeline">{rows.map((row, i) => <View key={row.title} style={s.row}>
    <View style={s.track}>{i < rows.length - 1 && <View style={s.line} />}<View style={[s.icon, i === rows.length - 1 && s.lastIcon]}>
      <Ionicons name={row.icon} size={20} color={i === rows.length - 1 ? EDITORIAL.cream : EDITORIAL.green} />
    </View></View>
    <View style={[s.copy, compact && s.copyCompact]}><Text style={s.title}>{row.title}</Text><Text style={[s.body, compact && s.bodyCompact]}>{row.body}</Text></View>
  </View>)}</View>;
}
const s = StyleSheet.create({
  timeline: { marginVertical: 12 },
  timelineCompact: { marginVertical: 7 },
  row: { flexDirection: 'row', gap: 14 },
  track: { width: 36, alignItems: 'center' },
  line: { position: 'absolute', top: 30, bottom: -8, width: 4, backgroundColor: EDITORIAL.greenAccentTint },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  lastIcon: { backgroundColor: EDITORIAL.green },
  copy: { flex: 1, paddingTop: 2, paddingBottom: 10 },
  copyCompact: { paddingBottom: 5 },
  title: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, lineHeight: 21, color: EDITORIAL.green },
  body: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 17, color: EDITORIAL.textMid, marginTop: 2 },
  bodyCompact: { fontSize: 12, lineHeight: 15 },
});
