import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { markInternalOrTestAccount } from '@/lib/launchAnalyticsPreferences';

/**
 * Dev-only: lets a staff/test account exclude itself from launch metrics.
 * Render this only behind `__DEV__` at the call site - it must never appear
 * for normal users.
 */
export function DevTestAccountControl() {
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

  async function save() {
    if (!user || busy) return;
    const current = revision.current;
    setBusy(true); setError(false);
    try { await markInternalOrTestAccount(user.id); }
    catch { if (revision.current === current) setError(true); }
    finally { setBusy(false); }
  }
  const excluded = user?.user_metadata?.fitsy_internal_or_test === true || user?.app_metadata?.fitsy_internal_or_test === true;
  return (
    <View style={s.card} testID="dev-test-account-control">
      <Text style={s.title}>Development: test account</Text>
      <Pressable accessibilityRole="button" testID="analytics-exclude-account" disabled={!user || busy || excluded}
        onPress={() => Alert.alert('Exclude this test account?', 'Use this for staff, testing or demos. This account will stay out of launch counts on every device.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Exclude account', onPress: () => void save() },
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
  link: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 13, lineHeight: 20, color: EDITORIAL.greenAccent },
  error: { fontFamily: FONTS.nunitoSans, fontSize: 13, color: '#B85450' },
});
