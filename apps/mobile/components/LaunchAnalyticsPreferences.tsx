import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { saveLaunchPreference, type LaunchPreference } from '@/lib/launchAnalyticsPreferences';

export function LaunchAnalyticsPreferences() {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  useFocusEffect(useCallback(() => {
    const initial = ++revision.current;
    void supabase.auth.getUser().then(({ data, error: readError }) => {
      if (revision.current === initial) {
        setUser(data.user?.is_anonymous ? null : data.user);
        setError(Boolean(readError));
      }
    }).catch(() => { if (revision.current === initial) setError(true); });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return; // getUser supplies a fresh server read.
      ++revision.current;
      setUser(session?.user && !session.user.is_anonymous ? session.user : null);
    });
    return () => { ++revision.current; data.subscription.unsubscribe(); };
  }, []));

  async function save(field: LaunchPreference, enabled: boolean) {
    if (!user || busy) return;
    const current = revision.current;
    setBusy(true); setError(false);
    try { await saveLaunchPreference(user.id, field, enabled); }
    catch { if (revision.current === current) setError(true); }
    finally { setBusy(false); }
  }
  const excluded = user?.user_metadata?.fitsy_internal_or_test === true || user?.app_metadata?.fitsy_internal_or_test === true;
  return (
    <View style={s.card} testID="launch-analytics-preferences">
      <Text style={s.title}>LA launch analytics</Text>
      <Text style={s.copy}>Optional: I use Fitsy in Los Angeles and agree to share my app activity with Fitsy through PostHog for LA launch analytics. No precise location or nutrition is shared. Turn this off anytime.</Text>
      <View style={s.row}>
        <Text style={s.label}>Include my LA activity</Text>
        <Switch testID="la-analytics-consent" accessibilityLabel="Include my LA activity"
          disabled={!user || busy} value={user?.user_metadata?.fitsy_la_cohort_consent_v1 === true}
          trackColor={{ true: EDITORIAL.greenAccent }} onValueChange={value => void save('fitsy_la_cohort_consent_v1', value)} />
      </View>
      <Pressable accessibilityRole="button" testID="analytics-exclude-account" disabled={!user || busy || excluded}
        onPress={() => Alert.alert('Exclude this test account?', 'Use this for staff, testing or demos. This account will stay out of launch counts on every device.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Exclude account', onPress: () => void save('fitsy_internal_or_test', true) },
        ])}>
        <Text style={s.link}>{excluded ? 'Test account excluded from launch counts' : 'Using a staff or test account? Exclude it'}</Text>
      </Pressable>
      {error && <Text accessibilityRole="alert" style={s.error}>Could not save your choice. Please try again.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: EDITORIAL.cream, borderColor: EDITORIAL.creamDeep, borderWidth: 1, borderRadius: 20, padding: 20, marginBottom: 16, gap: 12 },
  title: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 17, color: EDITORIAL.text },
  copy: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 20, color: EDITORIAL.textSoft },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, color: EDITORIAL.text, flexShrink: 1 },
  link: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 13, lineHeight: 20, color: EDITORIAL.greenAccent },
  error: { fontFamily: FONTS.nunitoSans, fontSize: 13, color: '#B85450' },
});
